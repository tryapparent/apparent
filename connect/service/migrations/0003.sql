/* Explicit per-capture read capabilities. Existing captures stay private. */
CREATE TABLE shares (
 id TEXT PRIMARY KEY,
 capture_id TEXT NOT NULL REFERENCES captures(id),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 hash TEXT NOT NULL UNIQUE,
 envelope TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 revoked_at INTEGER,
 upload_state TEXT NOT NULL DEFAULT 'uploading' CHECK(upload_state IN ('uploading','paused','failed'))
);
CREATE UNIQUE INDEX shares_active_capture ON shares(capture_id) WHERE revoked_at IS NULL;
CREATE INDEX shares_owner ON shares(account_id,created_at);
