import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Deps } from "./deps.js";
import { authenticate, originGuard } from "./middleware.js";
import { createAssessRouter } from "./routes/assess.js";
import { createAssessmentsRouter } from "./routes/assessments.js";
import { createAuthRouter } from "./routes/auth.js";
import { createLedgerRouter } from "./routes/ledger.js";

// Built by a factory (and kept separate from server.ts, which calls listen())
// so tests can mount the app on an ephemeral port with an in-memory database.
export function createApp(deps: Deps) {
  const { config, db, logger, agent } = deps;
  const app = express();

  app.disable("x-powered-by");
  if (config.TRUST_PROXY) app.set("trust proxy", 1); // so req.ip (and rate limits) see the client, not the proxy

  app.use(
    pinoHttp({
      logger,
      // Docker polls /healthz every few seconds; logging each poll buries real traffic.
      autoLogging: { ignore: (req) => req.url === "/healthz" },
      genReqId: (req) => String(req.headers["x-request-id"] ?? randomUUID()),
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
      // method, url, status and timing only: no bodies (submissions, passwords).
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: config.ALLOWED_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(originGuard(config));
  app.use(authenticate(db, config));

  // Liveness: the process is up. Readiness: it can actually do its job.
  app.get("/healthz", (_req, res) => void res.json({ status: "ok" }));
  app.get("/readyz", async (_req, res) => {
    const checks = { db: false, agent: false };
    try {
      db.prepare("SELECT 1").get();
      checks.db = true;
    } catch {
      /* reported below */
    }
    try {
      await agent.healthz();
      checks.agent = true;
    } catch {
      /* reported below */
    }
    res.status(checks.db && checks.agent ? 200 : 503).json(checks);
  });

  app.use("/api/auth", createAuthRouter(deps));
  app.use("/api", createAssessRouter(deps));
  app.use("/api", createAssessmentsRouter(deps));
  app.use("/api", createLedgerRouter(deps));

  app.use((_req, res) => void res.status(404).json({ error: "not found" }));

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    // express.json() reports malformed or oversized bodies with a status.
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) req.log.error({ err }, "unhandled error"); // detail goes to logs, never to the client
    res.status(status).json({ error: status === 500 ? "internal error" : status === 413 ? "request too large" : "bad request" });
  };
  app.use(onError);

  return app;
}
