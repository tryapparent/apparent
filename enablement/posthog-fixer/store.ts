import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, lstatSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import type {Spike, SpikePolicy} from './spikes/policy.ts';

export type Job = {issue: string; thread: string; command: string; state: 'queued' | 'launching' | 'active' | 'done' | 'held';
  payload: string | null; attempts: number; next_at: number; reserved_at: number | null; batch_thread: string | null; spike: Spike | null};
type StoredJob = Omit<Job, 'spike'> & {spike: string | null};
function decode(row: StoredJob): Job {
  return {...row, spike: row.spike === null ? null : JSON.parse(row.spike)};
}
export type SupportAccess = {report: string; digest: string; expiresAt: number};
export class Store {
  db!: DatabaseSync;
  private lock: DatabaseSync;
  constructor(directory: string, identity: string) {
    mkdirSync(directory, {recursive: true, mode: 0o700});
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077))
      throw Error('State directory must be private and owned');
    // A separate SQLite transaction is a crash-released process lock, not a stale PID file.
    this.lock = new DatabaseSync(join(directory, 'owner.sqlite'));
    try {
      chmodSync(join(directory, 'owner.sqlite'), 0o600);
      this.lock.exec('BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id INTEGER)');
      this.db = new DatabaseSync(join(directory, 'queue.sqlite'));
      chmodSync(join(directory, 'queue.sqlite'), 0o600);
      this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS metadata (identity TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (issue TEXT PRIMARY KEY, thread TEXT NOT NULL, command TEXT NOT NULL,
          state TEXT NOT NULL, payload TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
          reserved_at INTEGER);
        CREATE TABLE IF NOT EXISTS support_access (thread TEXT PRIMARY KEY, report TEXT NOT NULL,
          digest TEXT NOT NULL, expires_at INTEGER NOT NULL, downloads INTEGER NOT NULL DEFAULT 0);`);
      const existing = this.db.prepare('SELECT identity FROM metadata').get();
      if (existing && existing.identity !== identity) throw Error('Queue belongs to a different target; use a separate state directory');
      if (!existing) this.db.prepare('INSERT INTO metadata VALUES (?)').run(identity);
      const columns = this.db.prepare('PRAGMA table_info(jobs)').all().map(column => column.name);
      if (!columns.includes('batch_thread'))
        this.db.exec('ALTER TABLE jobs ADD COLUMN batch_thread TEXT');
      if (!columns.includes('spike')) this.db.exec('ALTER TABLE jobs ADD COLUMN spike TEXT');
      this.db.exec('CREATE TABLE IF NOT EXISTS spike_hot (issue TEXT PRIMARY KEY)');
    } catch (error) {if (this.db?.isOpen) this.db.close(); this.lock.close(); throw error;}
  }
  enqueue(issue: string, limit: number): 'accepted' | 'duplicate' | 'full' {
    if (this.db.prepare("SELECT 1 FROM jobs WHERE issue=? OR json_extract(spike,'$.issue')=?").get(issue, issue)) return 'duplicate';
    const count = this.db.prepare("SELECT count(*) AS n FROM jobs WHERE state != 'done'").get()!.n as number;
    if (count >= limit) return 'full';
    const identity = this.db.prepare('SELECT identity FROM metadata').get()!.identity;
    const hash = createHash('sha256').update(`${identity}:${issue}`).digest('hex');
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    this.db.prepare("INSERT INTO jobs(issue,thread,command,state) VALUES (?,?,?,'queued')").run(issue, id, `posthog-${id}`);
    return 'accepted';
  }
  jobs(): Job[] {return (this.db.prepare('SELECT * FROM jobs ORDER BY rowid').all() as StoredJob[]).map(decode);}
  nextLaunch(now: number, limit: number, batchSize: number): Job[] {
    const retry = this.db.prepare(`SELECT * FROM jobs WHERE state='launching' AND batch_thread IS NULL
      AND next_at<=? ORDER BY rowid LIMIT 1`).get(now) as StoredJob | undefined;
    if (retry) return [decode(retry)];
    if (this.dailyCount(now) >= limit) return [];
    const spike = this.db.prepare("SELECT * FROM jobs WHERE state='queued' AND next_at<=? AND spike IS NOT NULL ORDER BY rowid LIMIT 1")
      .get(now) as StoredJob | undefined;
    if (spike) return [decode(spike)];
    const jobs = this.db.prepare("SELECT * FROM jobs WHERE state='queued' AND next_at<=? AND spike IS NULL ORDER BY rowid LIMIT ?")
      .all(now, batchSize) as StoredJob[];
    return jobs.length === batchSize ? jobs.map(decode) : [];
  }
  recordSpikes(spikes: Spike[], queueLimit: number, policy: SpikePolicy): void {
    this.db.exec('BEGIN');
    try {
      const hot = new Set(this.db.prepare('SELECT issue FROM spike_hot').all().map(row => row.issue));
      this.db.exec('DELETE FROM spike_hot');
      const mark = this.db.prepare('INSERT INTO spike_hot VALUES (?)');
      const prior = this.db.prepare("SELECT max(reserved_at) AS last FROM jobs WHERE json_extract(spike,'$.issue')=?");
      const outstanding = this.db.prepare(`SELECT issue,state,spike FROM jobs
        WHERE state!='done' AND (issue=? OR json_extract(spike,'$.issue')=?) LIMIT 1`);
      const promote = this.db.prepare("UPDATE jobs SET spike=? WHERE issue=? AND state='queued' AND spike IS NULL");
      const insert = this.db.prepare("INSERT INTO jobs(issue,thread,command,state,spike) VALUES (?,?,?,'queued',?)");
      let count = Number(this.db.prepare("SELECT count(*) AS n FROM jobs WHERE state!='done'").get()!.n);
      for (const spike of spikes) {
        const last = prior.get(spike.issue)?.last as number | null;
        const elapsed = last === null ? 86400 : Math.min(86400, Math.max(0, Math.floor((spike.observedAt - last) / 1000)));
        if (policy.admits(hot.has(spike.issue), elapsed)) {
          const existing = outstanding.get(spike.issue, spike.issue);
          if (existing?.state === 'queued' && existing.spike === null) {
            promote.run(JSON.stringify(spike), spike.issue);
          } else if (!existing && count < queueLimit) {
            const id = randomUUID();
            insert.run(id, id, `posthog-${id}`, JSON.stringify(spike));
            count++;
          }
        }
        mark.run(spike.issue);
      }
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  reserve(jobs: Job[], payload: string, now: number, grants: Map<string, SupportAccess>): void {
    const [leader] = jobs;
    this.db.exec('BEGIN');
    try {
      const reserve = this.db.prepare(`UPDATE jobs SET state='launching',payload=?,reserved_at=?,batch_thread=?,attempts=0
        WHERE issue=? AND state='queued'`);
      const grant = this.db.prepare(
        'INSERT INTO support_access(thread,report,digest,expires_at) VALUES (?,?,?,?)',
      );
      for (const job of jobs) {
        const first = job.issue === leader.issue;
        const result = reserve.run(first ? payload : null, first ? now : null, first ? null : leader.thread, job.issue);
        if (result.changes !== 1) throw Error('Batch member is no longer queued');
        const access = grants.get(job.issue);
        if (access) grant.run(job.thread, access.report, access.digest, access.expiresAt);
      }
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  supportAccess(thread: string, digest: string, now: number): string | undefined {
    const claim = this.db.prepare(`UPDATE support_access SET downloads=downloads+1
      WHERE thread=? AND digest=? AND expires_at>? AND downloads<3
      AND EXISTS (SELECT 1 FROM jobs WHERE jobs.thread=support_access.thread AND state IN ('launching','active'))
      RETURNING report`).get(thread, digest, now);
    return claim?.report as string | undefined;
  }
  supportAccessActive(thread: string, now: number, digest: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM support_access JOIN jobs USING (thread)
      WHERE thread=? AND expires_at>? AND digest=? AND state IN ('launching','active')`).get(thread, now, digest));
  }
  update(issue: string, state: Job['state'], attempts = 0, next = 0): void {
    const leader = this.db.prepare('SELECT coalesce(batch_thread,thread) AS thread FROM jobs WHERE issue=?').get(issue);
    if (!leader) return;
    this.db.exec('BEGIN');
    try {
      if (state === 'done') this.db.prepare(`DELETE FROM support_access WHERE thread IN
        (SELECT thread FROM jobs WHERE thread=? OR batch_thread=?)`).run(leader.thread, leader.thread);
      this.db.prepare('UPDATE jobs SET state=?,attempts=?,next_at=? WHERE thread=? OR batch_thread=?')
        .run(state, attempts, next, leader.thread, leader.thread);
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  dailyCount(now: number): number {
    const start = now - now % 86400000;
    return this.db.prepare('SELECT count(*) AS n FROM jobs WHERE reserved_at >= ?').get(start)!.n as number;
  }
  close(): void {if (this.db.isOpen) this.db.close(); if (this.lock.isOpen) this.lock.close();}
}
