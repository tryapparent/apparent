/* Per-account pilot consent. Existing global permission is not account consent.
   Stop collection and discard legacy, unapproved queued analytics on upgrade.
   No account history is backfilled and no storage budget is changed. */
UPDATE analytics_control SET enabled=0;
DELETE FROM analytics_outbox;
/* An operator may record an explicit choice before account creation, using the
   exact opaque account ID. No foreign key: signup is eligible only if that
   reviewed pre-enrolment exists. Browser consent never populates this ledger. */
CREATE TABLE analytics_consent (
 account_id TEXT PRIMARY KEY CHECK(length(account_id)=64 AND account_id NOT GLOB '*[^a-f0-9]*'),
 consent_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))) UNIQUE,
 consented_at INTEGER NOT NULL CHECK(typeof(consented_at)='integer' AND consented_at>0 AND consented_at<=9007199254740991)
);
ALTER TABLE analytics_outbox ADD COLUMN consent_id TEXT;
CREATE TRIGGER analytics_consent_insert BEFORE INSERT ON analytics_consent BEGIN
 DELETE FROM analytics_outbox WHERE account_id=NEW.account_id;
END;
CREATE TRIGGER analytics_consent_update BEFORE UPDATE ON analytics_consent BEGIN
 SELECT RAISE(ABORT,'revoke and re-enrol with a new consent identity');
END;
CREATE TRIGGER analytics_consent_delete AFTER DELETE ON analytics_consent BEGIN
 DELETE FROM analytics_outbox WHERE account_id=OLD.account_id;
END;
CREATE TRIGGER analytics_account_delete AFTER DELETE ON accounts BEGIN
 DELETE FROM analytics_consent WHERE account_id=OLD.id;
 DELETE FROM analytics_outbox WHERE account_id=OLD.id;
END;
DROP TRIGGER analytics_signup;
DROP TRIGGER analytics_device;
DROP TRIGGER analytics_upload;
CREATE TRIGGER analytics_signup AFTER INSERT ON accounts
 WHEN (SELECT enabled FROM analytics_control WHERE id=1)=1 AND EXISTS (
  SELECT 1 FROM analytics_consent WHERE account_id=NEW.id AND consented_at<=NEW.created_at AND consented_at<=unixepoch('subsec')*1000
 ) BEGIN
 UPDATE analytics_control SET dropped=dropped+((SELECT count(*) FROM analytics_outbox)>=10000) WHERE id=1;
 INSERT INTO analytics_outbox(id,account_id,event,occurred_at,consent_id)
 SELECT 'signup:'||NEW.id,NEW.id,'connect_account_created',NEW.created_at,consent_id
 FROM analytics_consent WHERE account_id=NEW.id AND (SELECT count(*) FROM analytics_outbox)<10000;
END;
CREATE TRIGGER analytics_device AFTER UPDATE OF status ON devices
 WHEN NEW.status='approved' AND OLD.status='pending' AND (SELECT enabled FROM analytics_control WHERE id=1)=1 AND EXISTS (
  SELECT 1 FROM analytics_consent WHERE account_id=NEW.account_id AND consented_at<=unixepoch('subsec')*1000
 ) BEGIN
 UPDATE analytics_control SET dropped=dropped+((SELECT count(*) FROM analytics_outbox)>=10000) WHERE id=1;
 INSERT INTO analytics_outbox(id,account_id,event,occurred_at,consent_id)
 SELECT 'device:'||NEW.hash,NEW.account_id,'connect_device_connected',CAST(unixepoch('subsec')*1000 AS INTEGER),consent_id
 FROM analytics_consent WHERE account_id=NEW.account_id AND (SELECT count(*) FROM analytics_outbox)<10000;
END;
CREATE TRIGGER analytics_upload AFTER UPDATE OF status ON captures
 WHEN NEW.status='ready' AND OLD.status='pending' AND (SELECT enabled FROM analytics_control WHERE id=1)=1 AND EXISTS (
  SELECT 1 FROM analytics_consent WHERE account_id=NEW.account_id AND consented_at<=unixepoch('subsec')*1000
 ) BEGIN
 UPDATE analytics_control SET dropped=dropped+((SELECT count(*) FROM analytics_outbox)>=10000) WHERE id=1;
 INSERT INTO analytics_outbox(id,account_id,event,occurred_at,bytes,captures,consent_id)
 SELECT 'upload:'||NEW.id,NEW.account_id,'connect_upload_completed',CAST(unixepoch('subsec')*1000 AS INTEGER),NEW.bytes,1,consent_id
 FROM analytics_consent WHERE account_id=NEW.account_id AND (SELECT count(*) FROM analytics_outbox)<10000;
END;
