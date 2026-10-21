// Disable an account and end its sessions: EMAIL=... node dist/scripts/disable-user.js
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";

const cfg = loadConfig();
const db = openDb(cfg.DATABASE_PATH);
try {
  const email = String(process.env.EMAIL ?? "").trim().toLowerCase();
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (!user) {
    console.error(`no such user: ${email}`);
    process.exitCode = 1;
  } else {
    db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(user.id);
    const ended = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id).changes;
    console.log(`disabled ${email}; ended ${ended} session(s)`);
  }
} finally {
  db.close();
}
