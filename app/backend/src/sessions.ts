import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db.js";
import type { Role, User } from "./users.js";

// The browser holds a random token; the database holds only its SHA-256, so a
// leaked database (or backup) can't be replayed as live sessions.
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(db: Db, userId: string, ttlHours: number): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hash(token), userId, now.toISOString(), expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

/** The user behind a live session, or undefined if the token is unknown,
 *  expired, or belongs to a disabled account. */
export function lookupSession(db: Db, token: string): User | undefined {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
    )
    .get(hash(token), new Date().toISOString()) as { id: string; email: string; name: string; role: Role } | undefined;
  return row;
}

export function destroySession(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
}

export function purgeExpiredSessions(db: Db): number {
  return db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString()).changes;
}
