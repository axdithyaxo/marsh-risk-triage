import { createAgentClient } from "./agentClient.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createLogger } from "./logger.js";
import { seedDemoUsers } from "./seed.js";
import { purgeExpiredSessions } from "./sessions.js";

const config = loadConfig(); // throws, and the process exits non-zero, on a bad config
const logger = createLogger(config);
const db = openDb(config.DATABASE_PATH);
await seedDemoUsers(db, config, logger);

if (config.APP_ENV === "development" && config.TRIAGE_INTERNAL_TOKEN.startsWith("dev-only")) {
  logger.warn("using the public development internal token; fine locally, refused in production");
}

const app = createApp({ config, db, logger, agent: createAgentClient(config) });
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT, env: config.APP_ENV }, "backend listening"));

const sweeper = setInterval(() => purgeExpiredSessions(db), 3_600_000);
sweeper.unref();

// Finish in-flight requests, then close the database cleanly, so a deploy or
// `docker stop` doesn't cut an assessment or a write in half.
function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  clearInterval(sweeper);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // don't hang forever on a stuck connection
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
