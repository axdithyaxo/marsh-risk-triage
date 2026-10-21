import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

// Append new migrations to the END; never edit one that has shipped.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('underwriter', 'auditor')),
    password_hash TEXT NOT NULL,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE assessments (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id),
    status              TEXT NOT NULL CHECK (status IN ('needs_review', 'decided', 'blocked', 'rejected')),
    created_at          TEXT NOT NULL,
    submission_redacted TEXT,
    submission_sha256   TEXT,
    evidence_json       TEXT,
    evidence_signature  TEXT,
    reason              TEXT,
    decision            TEXT,
    rationale           TEXT,
    decided_by          TEXT REFERENCES users(id),
    decided_at          TEXT,
    audit_seq           INTEGER,
    audit_entry_hash    TEXT
  );
  CREATE INDEX idx_assessments_user ON assessments(user_id, created_at);
  `,
];

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Db): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const current = (db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number }).v;
  for (let v = current; v < MIGRATIONS.length; v++) {
    // One transaction per migration: a failure leaves the schema at the last good version.
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v + 1, new Date().toISOString());
    })();
  }
  return MIGRATIONS.length;
}
