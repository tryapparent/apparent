-- Expand the transport discriminator without rebuilding captures or changing
-- reservation sequences, foreign keys, triggers, objects or budget ledgers.
ALTER TABLE captures RENAME COLUMN format TO legacy_format;
ALTER TABLE captures ADD COLUMN format TEXT NOT NULL DEFAULT 'plaintext-v1' CHECK(format IN ('plaintext-v1','apparent-encrypted-v1','apparent-encrypted-v2'));
UPDATE captures SET format=legacy_format;
ALTER TABLE captures DROP COLUMN legacy_format;
