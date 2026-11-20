ALTER TABLE product_activity ADD COLUMN last_cadence_day TEXT;
ALTER TABLE product_activity ADD COLUMN daily_uploads INTEGER NOT NULL DEFAULT 0 CHECK(daily_uploads>=0);

ALTER TABLE product_activity_history ADD COLUMN connect_uploads INTEGER CHECK(connect_uploads>=0);
ALTER TABLE product_activity_history ADD COLUMN connect_upload_accounts INTEGER CHECK(connect_upload_accounts>0);

CREATE VIEW reporting_connect_upload_cadence AS
 SELECT day_utc, connect_uploads AS completed_uploads, connect_upload_accounts AS active_accounts
 FROM product_activity_history;
