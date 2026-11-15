export const scheduleSchema = [
  `CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id = 1), identity TEXT NOT NULL) STRICT`,
  `CREATE TABLE records (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('task','event')), version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data))) STRICT`,
  `CREATE TABLE receipts (request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL) STRICT`,
  `CREATE TABLE reminders (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES records(id), revision INTEGER NOT NULL, due_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','delivered','cancelled')), snapshot TEXT NOT NULL CHECK(json_valid(snapshot))) STRICT`,
  `CREATE TABLE notifications (id TEXT PRIMARY KEY REFERENCES reminders(id), created_at TEXT NOT NULL, read_at TEXT, claimed_at TEXT, missed INTEGER NOT NULL CHECK(missed IN (0,1)), snapshot TEXT NOT NULL CHECK(json_valid(snapshot))) STRICT`,
  `CREATE INDEX records_kind ON records(kind, id)`,
  `CREATE INDEX reminders_due ON reminders(state, due_at)`,
  `CREATE INDEX reminders_owner ON reminders(owner_id, state)`,
];
