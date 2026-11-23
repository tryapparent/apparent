ALTER TABLE captures ADD COLUMN style_history INTEGER NOT NULL DEFAULT 0 CHECK(style_history IN (0,1));
