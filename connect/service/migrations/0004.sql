/* Optional product analytics. Apply separately; collection stays OFF until an
   operator enables this row after privacy/access/retention review. No content,
   URLs, emails, credentials, manifests or capability identifiers are copied. */
CREATE TABLE analytics_control (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 dropped INTEGER NOT NULL DEFAULT 0, snapshot_day INTEGER NOT NULL DEFAULT -1
);
INSERT INTO analytics_control(id) VALUES(1);
CREATE TABLE analytics_outbox (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, event TEXT NOT NULL,
 occurred_at INTEGER NOT NULL, bytes INTEGER NOT NULL DEFAULT 0,
 captures INTEGER NOT NULL DEFAULT 0, pending_bytes INTEGER NOT NULL DEFAULT 0,
 physical_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX analytics_delivery ON analytics_outbox(occurred_at,id);
/* A bounded outbox must not reject a product action during an analytics outage.
   Overflow increments a visible counter; totals after overflow are incomplete. */
CREATE TRIGGER analytics_signup AFTER INSERT ON accounts
 WHEN (SELECT enabled FROM analytics_control WHERE id=1)=1 BEGIN
 UPDATE analytics_control SET dropped=dropped+((SELECT count(*) FROM analytics_outbox)>=10000) WHERE id=1;
 INSERT INTO analytics_outbox(id,account_id,event,occurred_at)
 SELECT 'signup:'||NEW.id,NEW.id,'connect_account_created',NEW.created_at
 WHERE (SELECT count(*) FROM analytics_outbox)<10000;
END;
CREATE TRIGGER analytics_device AFTER UPDATE OF status ON devices
 WHEN NEW.status='approved' AND OLD.status='pending' AND (SELECT enabled FROM analytics_control WHERE id=1)=1 BEGIN
 UPDATE analytics_control SET dropped=dropped+((SELECT count(*) FROM analytics_outbox)>=10000) WHERE id=1;
 INSERT INTO analytics_outbox(id,account_id,event,occurred_at)
 SELECT 'device:'||NEW.hash,NEW.account_id,'connect_device_connected',CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE (SELECT count(*) FROM analytics_outbox)<10000;
END;
CREATE TRIGGER analytics_upload AFTER UPDATE OF status ON captures
 WHEN NEW.status='ready' AND OLD.status='pending' AND (SELECT enabled FROM analytics_control WHERE id=1)=1 BEGIN
 UPDATE analytics_control SET dropped=dropped+((SELECT count(*) FROM analytics_outbox)>=10000) WHERE id=1;
 INSERT INTO analytics_outbox(id,account_id,event,occurred_at,bytes,captures)
 SELECT 'upload:'||NEW.id,NEW.account_id,'connect_upload_completed',CAST(unixepoch('subsec')*1000 AS INTEGER),NEW.bytes,1
 WHERE (SELECT count(*) FROM analytics_outbox)<10000;
END;
