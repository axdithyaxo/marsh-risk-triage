// Create an account: EMAIL=... NAME=... ROLE=underwriter|auditor PASSWORD=... node dist/scripts/create-user.js
// (the password is read from the environment so it never appears in `ps` or shell history arguments).
import { ZodError } from "zod";
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";
import { createUser, UserExistsError } from "../users.js";

const cfg = loadConfig();
const db = openDb(cfg.DATABASE_PATH);
try {
  const user = await createUser(db, {
    email: process.env.EMAIL,
    name: process.env.NAME,
    role: process.env.ROLE,
    password: process.env.PASSWORD,
  });
  console.log(`created ${user.role} ${user.email} (${user.id})`);
} catch (err) {
  const reason =
    err instanceof UserExistsError ? err.message
    : err instanceof ZodError ? `could not create user: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    : `could not create user: ${err instanceof Error ? err.message : err}`;
  console.error(reason);
  process.exitCode = 1;
} finally {
  db.close();
}
