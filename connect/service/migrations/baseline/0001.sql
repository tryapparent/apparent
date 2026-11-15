PRAGMA foreign_keys = ON;
CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL, beta TEXT NOT NULL CHECK(beta IN ('active','waitlist')), interest INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TRIGGER slot_limit BEFORE INSERT ON accounts WHEN NEW.beta='active' AND (SELECT count(*) FROM accounts WHERE beta='active')>=20 BEGIN SELECT RAISE(ABORT,'beta_full'); END;
CREATE TABLE sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE oauth_states (hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, return_to TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE tokens (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), scope TEXT NOT NULL CHECK(scope IN ('read','upload')), expires_at INTEGER NOT NULL);
CREATE TABLE devices (hash TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE, scope TEXT NOT NULL CHECK(scope IN ('read','upload')), status TEXT NOT NULL DEFAULT 'pending', account_id TEXT REFERENCES accounts(id), token_hash TEXT, envelope TEXT, expires_at INTEGER NOT NULL, last_poll INTEGER NOT NULL DEFAULT 0);
CREATE TABLE captures (reservation_seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES accounts(id), manifest TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>=0 AND bytes<=500000000), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','deleted')), expires_at INTEGER NOT NULL, pending_until INTEGER NOT NULL);
CREATE INDEX captures_owner ON captures(account_id,status,expires_at);
CREATE INDEX captures_age ON captures(account_id,reservation_seq);
/* AFTER INSERT runs only for a new ID, never a retry/unique conflict. The
   reservation and oldest-prefix tombstones commit or roll back with its files.
   Keep the largest newest suffix that fits; never skip an older large capture
   to evict a newer small one. Pending uploads participate, including in flight. */
CREATE TRIGGER quota_evict AFTER INSERT ON captures BEGIN
 UPDATE captures SET status='deleted' WHERE reservation_seq IN (
  SELECT reservation_seq FROM (
   SELECT reservation_seq, sum(bytes) OVER (ORDER BY reservation_seq DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS suffix_bytes
   FROM captures WHERE account_id=NEW.account_id AND status!='deleted' AND expires_at>unixepoch('subsec')*1000 AND (status='ready' OR pending_until>unixepoch('subsec')*1000)
  ) WHERE suffix_bytes>500000000
 );
END;
CREATE TABLE files (capture_id TEXT NOT NULL REFERENCES captures(id), path TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, object_key TEXT, PRIMARY KEY(capture_id,path));
CREATE TABLE attempts (key TEXT PRIMARY KEY, capture_id TEXT NOT NULL REFERENCES captures(id), created_at INTEGER NOT NULL, cleaned_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX attempts_capture ON attempts(capture_id);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
