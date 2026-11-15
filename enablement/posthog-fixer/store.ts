import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, lstatSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export type Job = {issue: string; thread: string; command: string; state: 'queued' | 'launching' | 'active' | 'done' | 'held';
  payload: string | null; attempts: number; next_at: number; reserved_at: number | null};
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
          reserved_at INTEGER);`);
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
  reserve(job: Job, payload: string, now: number): void {
    this.db.prepare("UPDATE jobs SET state='launching',payload=?,reserved_at=?,attempts=0 WHERE issue=? AND state='queued'").run(payload, now, job.issue);
  }
  update(issue: string, state: Job['state'], attempts = 0, next = 0): void {
    this.db.prepare('UPDATE jobs SET state=?,attempts=?,next_at=? WHERE issue=?').run(state, attempts, next, issue);
  }
  dailyCount(now: number): number {
    const start = now - now % 86400000;
    return this.db.prepare('SELECT count(*) AS n FROM jobs WHERE reserved_at >= ?').get(start)!.n as number;
  }
  close(): void {if (this.db.isOpen) this.db.close(); if (this.lock.isOpen) this.lock.close();}
}
