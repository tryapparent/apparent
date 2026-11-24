ALTER TABLE captures ADD COLUMN recorded_at INTEGER CHECK(recorded_at > 0);
CREATE INDEX captures_recorded ON captures(account_id, recorded_at DESC, reservation_seq DESC)
 WHERE status!='deleted';
