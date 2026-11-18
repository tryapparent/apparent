CREATE TABLE product_activity_history (
 day_utc TEXT PRIMARY KEY,
 desktop_daily INTEGER CHECK(desktop_daily > 0),
 connect_daily INTEGER CHECK(connect_daily > 0 AND connect_daily <= desktop_daily),
 desktop_weekly INTEGER CHECK(desktop_weekly > 0),
 connect_weekly INTEGER CHECK(connect_weekly > 0 AND connect_weekly <= desktop_weekly),
 as_of_ms INTEGER NOT NULL
);

INSERT INTO product_activity_history(day_utc, as_of_ms)
VALUES(date('now'), CAST(unixepoch('subsec') * 1000 AS INTEGER));

CREATE VIEW reporting_product_activity_history AS
 SELECT day_utc, desktop_daily, connect_daily, desktop_weekly, connect_weekly, as_of_ms
 FROM product_activity_history;
