CREATE TABLE capture_quota_reservations (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 bytes INTEGER NOT NULL CHECK(bytes >= 0)
) WITHOUT ROWID;

INSERT INTO capture_quota_reservations(account_id,bytes)
 SELECT account_id,sum(bytes) FROM captures
 WHERE status!='deleted'
 AND COALESCE(json_extract(manifest,'$[0].path')='support/part-0.age',0)=0
 GROUP BY account_id;

DROP TRIGGER capture_library_quota_evict;

CREATE TRIGGER capture_quota_release AFTER UPDATE OF status ON captures
 WHEN OLD.status!='deleted' AND NEW.status='deleted' AND OLD.bytes>0
 AND COALESCE(json_extract(OLD.manifest,'$[0].path')='support/part-0.age',0)=0 BEGIN
 UPDATE capture_quota_reservations SET bytes=bytes-OLD.bytes WHERE account_id=OLD.account_id;
END;

CREATE TRIGGER capture_quota_delete AFTER DELETE ON captures
 WHEN OLD.status!='deleted' AND OLD.bytes>0
 AND COALESCE(json_extract(OLD.manifest,'$[0].path')='support/part-0.age',0)=0 BEGIN
 UPDATE capture_quota_reservations SET bytes=bytes-OLD.bytes WHERE account_id=OLD.account_id;
END;

CREATE TRIGGER capture_library_quota_evict AFTER INSERT ON captures
 WHEN NEW.status!='deleted'
 AND COALESCE(json_extract(NEW.manifest,'$[0].path')='support/part-0.age',0)=0 BEGIN
 INSERT INTO capture_quota_reservations(account_id,bytes) VALUES(NEW.account_id,NEW.bytes)
 ON CONFLICT(account_id) DO UPDATE SET bytes=bytes+excluded.bytes;
 UPDATE captures SET status='deleted' WHERE reservation_seq IN (
  SELECT reservation_seq FROM (
   SELECT reservation_seq, sum(bytes) OVER (ORDER BY reservation_seq DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS suffix_bytes
   FROM captures WHERE account_id=NEW.account_id AND status!='deleted' AND expires_at>unixepoch('subsec')*1000 AND (status='ready' OR pending_until>unixepoch('subsec')*1000)
   AND COALESCE(json_extract(manifest,'$[0].path')='support/part-0.age',0)=0
  ) WHERE suffix_bytes>500000000
  LIMIT CASE WHEN (SELECT bytes FROM capture_quota_reservations WHERE account_id=NEW.account_id)>500000000
   THEN -1 ELSE 0 END
 );
END;
