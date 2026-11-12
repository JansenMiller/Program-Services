'use strict';
// SQLite via Node's built-in node:sqlite (no npm dependencies).
// On Render the database file lives on the persistent disk at DATA_DIR.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'portal.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('supervisor','caseworker','chaplain')),
  password_hash TEXT NOT NULL,
  must_change   INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY,
  ts     INTEGER NOT NULL,
  actor  TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip     TEXT
);
CREATE TABLE IF NOT EXISTS ideas (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  details    TEXT,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','planned','done','declined')),
  created_at INTEGER NOT NULL
);
`);

// Small forward-only migrations so an existing database picks up new columns.
function addColumn(table, column, ddl) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('users', 'facility', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'demo', 'INTEGER NOT NULL DEFAULT 0');

// Chapel calendars. Every table carries a `demo` flag so sample data for demo accounts never mixes with real data.
db.exec(`
CREATE TABLE IF NOT EXISTS cal_series (
  id         INTEGER PRIMARY KEY,
  facility   TEXT NOT NULL,
  demo       INTEGER NOT NULL DEFAULT 0,
  rule       TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cal_events (
  id         INTEGER PRIMARY KEY,
  facility   TEXT NOT NULL,
  demo       INTEGER NOT NULL DEFAULT 0,
  date       TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service','study','special','closed')),
  all_day    INTEGER NOT NULL DEFAULT 0,
  start_time TEXT NOT NULL DEFAULT '',
  end_time   TEXT NOT NULL DEFAULT '',
  location   TEXT NOT NULL DEFAULT '',
  series_id  INTEGER REFERENCES cal_series(id) ON DELETE SET NULL,
  created_by INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_events_lookup ON cal_events (demo, facility, date);
CREATE INDEX IF NOT EXISTS idx_cal_events_series ON cal_events (series_id, date);
CREATE TABLE IF NOT EXISTS cal_orgs (
  id         INTEGER PRIMARY KEY,
  facility   TEXT NOT NULL,
  demo       INTEGER NOT NULL DEFAULT 0,
  name       TEXT NOT NULL COLLATE NOCASE,
  kind       TEXT NOT NULL DEFAULT 'service',
  detail     TEXT NOT NULL DEFAULT '',
  all_day    INTEGER NOT NULL DEFAULT 0,
  start_time TEXT NOT NULL DEFAULT '',
  end_time   TEXT NOT NULL DEFAULT '',
  location   TEXT NOT NULL DEFAULT '',
  last_used  INTEGER NOT NULL,
  UNIQUE (facility, demo, name)
);
CREATE TABLE IF NOT EXISTS cal_months (
  facility     TEXT NOT NULL,
  demo         INTEGER NOT NULL DEFAULT 0,
  ym           TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  chaplain     TEXT NOT NULL DEFAULT '',
  warden       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  finalized_at INTEGER,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (facility, demo, ym)
);
`);

// Monthly Statistical and Tracking Report (social workers) and its Graduation Roster.
db.exec(`
CREATE TABLE IF NOT EXISTS rr_reports (
  facility     TEXT NOT NULL,
  demo         INTEGER NOT NULL DEFAULT 0,
  ym           TEXT NOT NULL,
  data         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at INTEGER,
  submitted_by TEXT,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT,
  PRIMARY KEY (facility, demo, ym)
);
CREATE TABLE IF NOT EXISTS rr_roster (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  facility   TEXT NOT NULL,
  demo       INTEGER NOT NULL DEFAULT 0,
  ais        TEXT NOT NULL,
  program    TEXT NOT NULL,
  grad_date  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  UNIQUE (facility, demo, ais, program, grad_date)
);
CREATE INDEX IF NOT EXISTS idx_rr_roster_lookup ON rr_roster (demo, facility, grad_date);
`);

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
