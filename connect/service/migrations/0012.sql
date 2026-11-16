/* Prospective activity only. No scan/backfill of accounts or recordings. */
CREATE TABLE product_activity_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 collection_started_at_ms INTEGER NOT NULL,
 as_of_ms INTEGER NOT NULL
);
INSERT INTO product_activity_state VALUES(1,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER));
/* HMAC-derived, product-specific subject; never email, Google ID or account ID.
   Latest UTC date only; expiry is seven days after that date begins. */
CREATE TABLE product_activity (
 subject TEXT PRIMARY KEY CHECK(length(subject)=64 AND subject NOT GLOB '*[^a-f0-9]*'),
 product TEXT NOT NULL CHECK(product IN ('desktop','connect')),
 last_day TEXT NOT NULL
);
CREATE INDEX product_activity_expiry ON product_activity(product,last_day);
/* Typed backing columns preserve connector schema even with no observations.
   Zero admissions mean unknown under fail-open collection. */
CREATE TABLE product_activity_totals (
 product TEXT PRIMARY KEY CHECK(product IN ('desktop','connect')),
 day_utc TEXT NOT NULL,
 daily_active_accounts INTEGER CHECK(daily_active_accounts IS NULL OR daily_active_accounts>0),
 weekly_active_accounts INTEGER CHECK(weekly_active_accounts IS NULL OR weekly_active_accounts>0),
 coverage TEXT NOT NULL DEFAULT 'observed_lower_bound' CHECK(coverage='observed_lower_bound')
);
INSERT INTO product_activity_totals(product,day_utc) VALUES('desktop',date('now')),('connect',date('now'));
CREATE TRIGGER product_activity_insert AFTER INSERT ON product_activity BEGIN
 UPDATE product_activity_totals SET day_utc=date('now'),
 daily_active_accounts=(SELECT NULLIF(count(*),0) FROM product_activity WHERE product=NEW.product AND last_day=date('now')),
 weekly_active_accounts=(SELECT NULLIF(count(*),0) FROM product_activity WHERE product=NEW.product AND last_day>=date('now','-6 days') AND last_day<=date('now'))
 WHERE product=NEW.product;
END;
CREATE TRIGGER product_activity_update AFTER UPDATE OF last_day ON product_activity BEGIN
 UPDATE product_activity_totals SET day_utc=date('now'),
 daily_active_accounts=(SELECT NULLIF(count(*),0) FROM product_activity WHERE product=NEW.product AND last_day=date('now')),
 weekly_active_accounts=(SELECT NULLIF(count(*),0) FROM product_activity WHERE product=NEW.product AND last_day>=date('now','-6 days') AND last_day<=date('now'))
 WHERE product=NEW.product;
END;
/* ONLY this aggregate view may be enabled in the warehouse connector. */
CREATE VIEW reporting_product_activity AS
 SELECT t.product,t.day_utc,t.daily_active_accounts,t.weekly_active_accounts,
 s.collection_started_at_ms,s.as_of_ms,t.coverage
 FROM product_activity_totals t CROSS JOIN product_activity_state s WHERE s.id=1;
