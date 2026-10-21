import { randomBytes } from "node:crypto";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { Logger } from "./logger.js";
import { countUsers, createUser } from "./users.js";

/** Development convenience only (refused in production by loadConfig): when the
 *  database has no users, create one underwriter and one auditor. With no
 *  DEMO_PASSWORD set, a random one is generated and written to the console once;
 *  nothing is ever hard-coded. */
export async function seedDemoUsers(db: Db, cfg: Pick<Config, "SEED_DEMO_USERS" | "DEMO_PASSWORD">, logger: Logger) {
  if (!cfg.SEED_DEMO_USERS || countUsers(db) > 0) return;
  const generated = !cfg.DEMO_PASSWORD;
  const password = cfg.DEMO_PASSWORD ?? randomBytes(12).toString("base64url");
  const users = [
    { email: "underwriter@demo.local", name: "Demo Underwriter", role: "underwriter" },
    { email: "auditor@demo.local", name: "Demo Auditor", role: "auditor" },
  ];
  for (const u of users) await createUser(db, { ...u, password });
  logger.warn({ emails: users.map((u) => u.email) }, "demo users created (development only)");
  if (generated) console.log(`\nDEMO LOGINS (development only): ${users.map((u) => u.email).join(", ")}\nPassword: ${password}\n`);
}
