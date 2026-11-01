/* PRECONDITION: writes stopped; operator verified the bound Standard R2 bucket
   is fresh and empty. SQL cannot verify R2. Never apply this seed to an existing
   bucket: inventory/reconcile all physical attempts under operator review first.
   D1 migrations run once; rerunning this file errors, never resets counters. */
CREATE TABLE r2_budget (
 id INTEGER PRIMARY KEY CHECK(id=1),
 a_used INTEGER NOT NULL, a_cap INTEGER NOT NULL,
 b_used INTEGER NOT NULL, b_cap INTEGER NOT NULL,
 physical_used INTEGER NOT NULL, physical_cap INTEGER NOT NULL
);
INSERT INTO r2_budget SELECT 1,0,500000,0,5000000,0,9500000000
 WHERE NOT EXISTS(SELECT 1 FROM captures) AND NOT EXISTS(SELECT 1 FROM attempts);
ALTER TABLE attempts ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN terminal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN released INTEGER NOT NULL DEFAULT 0;
