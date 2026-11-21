import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, lstatSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export type Job = {issue: string; thread: string; command: string; state: 'queued' | 'launching' | 'active' | 'done' | 'held';
  payload: string | null; attempts: number; next_at: number; reserved_at: number | null};
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
    } catch (error) {if (this.db?.isOpen) this.db.close(); this.lock.close(); throw error;}
  }
  enqueue(issue: string, limit: number): 'accepted' | 'duplicate' | 'full' {
    if (this.db.prepare('SELECT 1 FROM jobs WHERE issue=?').get(issue)) return 'duplicate';
    const count = this.db.prepare("SELECT count(*) AS n FROM jobs WHERE state != 'done'").get()!.n as number;
    if (count >= limit) return 'full';
    const identity = this.db.prepare('SELECT identity FROM metadata').get()!.identity;
    const hash = createHash('sha256').update(`${identity}:${issue}`).digest('hex');
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    this.db.prepare("INSERT INTO jobs(issue,thread,command,state) VALUES (?,?,?,'queued')").run(issue, id, `posthog-${id}`);
    return 'accepted';
  }
  jobs(): Job[] {return this.db.prepare('SELECT * FROM jobs ORDER BY rowid').all() as Job[];}
  reserve(job: Job, payload: string, now: number, access?: SupportAccess): void {
    this.db.exec('BEGIN');
    try {
      const result = this.db.prepare("UPDATE jobs SET state='launching',payload=?,reserved_at=?,attempts=0 WHERE issue=? AND state='queued'").run(payload, now, job.issue);
      if (result.changes === 1 && access) this.db.prepare(
        'INSERT INTO support_access(thread,report,digest,expires_at) VALUES (?,?,?,?)',
      ).run(job.thread, access.report, access.digest, access.expiresAt);
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
    if (state === 'done') this.db.prepare('DELETE FROM support_access WHERE thread=(SELECT thread FROM jobs WHERE issue=?)').run(issue);
    this.db.prepare('UPDATE jobs SET state=?,attempts=?,next_at=? WHERE issue=?').run(state, attempts, next, issue);
  }
  dailyCount(now: number): number {
    const start = now - now % 86400000;
    return this.db.prepare('SELECT count(*) AS n FROM jobs WHERE reserved_at >= ?').get(start)!.n as number;
  }
  close(): void {if (this.db.isOpen) this.db.close(); if (this.lock.isOpen) this.lock.close();}
}
