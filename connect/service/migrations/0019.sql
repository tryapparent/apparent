ALTER TABLE attempts ADD COLUMN published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1));

UPDATE attempts SET published=1
 WHERE released!=1 AND key IN (SELECT object_key FROM files WHERE object_key IS NOT NULL);

CREATE TABLE capture_cleanup_queue (
 capture_id TEXT PRIMARY KEY REFERENCES captures(id) ON DELETE CASCADE
) WITHOUT ROWID;

INSERT INTO capture_cleanup_queue(capture_id)
 SELECT DISTINCT c.id FROM captures c JOIN attempts a ON a.capture_id=c.id
 WHERE c.status='deleted' AND a.terminal=1 AND a.released!=1;

DROP INDEX attempts_cleanup_terminal;
CREATE INDEX attempts_cleanup_terminal ON attempts(capture_id,cleaned_at,key)
 WHERE terminal=1 AND released!=1;
CREATE INDEX attempts_cleanup_orphan ON attempts(created_at)
 WHERE terminal=1 AND released!=1 AND published=0;

CREATE TRIGGER queue_deleted_capture AFTER UPDATE OF status ON captures
 WHEN NEW.status='deleted' AND OLD.status!='deleted'
 AND EXISTS(SELECT 1 FROM attempts WHERE capture_id=NEW.id AND terminal=1 AND released!=1) BEGIN
 INSERT OR IGNORE INTO capture_cleanup_queue(capture_id) VALUES(NEW.id);
END;

CREATE TRIGGER queue_late_terminal_attempt AFTER UPDATE OF terminal ON attempts
 WHEN OLD.terminal=0 AND NEW.terminal=1 AND NEW.released!=1
 AND EXISTS(SELECT 1 FROM captures WHERE id=NEW.capture_id AND status='deleted') BEGIN
 INSERT OR IGNORE INTO capture_cleanup_queue(capture_id) VALUES(NEW.capture_id);
END;

CREATE TRIGGER publish_storage_attempt AFTER UPDATE OF object_key ON files
 WHEN OLD.object_key IS NULL AND NEW.object_key IS NOT NULL BEGIN
 UPDATE attempts SET terminal=1,published=1
 WHERE key=NEW.object_key AND capture_id=NEW.capture_id AND released=0;
END;
