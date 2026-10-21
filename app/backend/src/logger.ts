import pino from "pino";
import type { Config } from "./config.js";

/** JSON logs with credentials redacted at the logger, so no code path can leak
 *  a cookie or password by logging a whole request. Submissions and rationales
 *  are never logged by the application. */
export function createLogger(cfg: Pick<Config, "LOG_LEVEL">, destination?: pino.DestinationStream) {
  return pino(
    {
      level: cfg.LOG_LEVEL,
      base: { svc: "backend" },
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          'req.headers["x-internal-token"]',
          'res.headers["set-cookie"]',
          "password",
          "*.password",
        ],
        censor: "[redacted]",
      },
    },
    destination,
  );
}

export type Logger = ReturnType<typeof createLogger>;
