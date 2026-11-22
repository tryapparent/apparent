DROP TRIGGER quota_evict;

CREATE TRIGGER capture_library_quota_evict AFTER INSERT ON captures
WHEN COALESCE(json_extract(NEW.manifest,'$[0].path')='support/part-0.age',0)=0
BEGIN
 UPDATE captures SET status='deleted' WHERE reservation_seq IN (
  SELECT reservation_seq FROM (
   SELECT reservation_seq, sum(bytes) OVER (ORDER BY reservation_seq DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS suffix_bytes
   FROM captures WHERE account_id=NEW.account_id AND status!='deleted' AND expires_at>unixepoch('subsec')*1000 AND (status='ready' OR pending_until>unixepoch('subsec')*1000)
   AND COALESCE(json_extract(manifest,'$[0].path')='support/part-0.age',0)=0
  ) WHERE suffix_bytes>500000000
 );
END;
