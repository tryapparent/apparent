CREATE TABLE support_reports (
  id TEXT PRIMARY KEY,
  upload_hash TEXT NOT NULL,
  digest TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  cleaned INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX support_reports_expiry ON support_reports(expires_at);
