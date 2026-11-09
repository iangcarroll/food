-- One row per establishment for the bulk-download cities (LA County, Las Vegas).
-- Each refresh writes a new `gen`, flips meta.gen:<city>, then deletes old generations.
CREATE TABLE facilities (
  city        TEXT    NOT NULL,
  gen         INTEGER NOT NULL,
  id          TEXT    NOT NULL,
  name_key    TEXT    NOT NULL, -- uppercase alphanumerics only (LV: name|location)
  address_up  TEXT    NOT NULL,
  zip         TEXT,
  sort_key    TEXT    NOT NULL,
  summary     TEXT    NOT NULL, -- JSON
  inspections TEXT    NOT NULL, -- JSON, newest first
  PRIMARY KEY (city, gen, id)
) WITHOUT ROWID;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
