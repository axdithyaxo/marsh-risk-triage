import type { Response } from "express";
import type { ZodTypeAny, z } from "zod";
import { AgentError } from "../agentClient.js";
import type { Logger } from "../logger.js";

/** Validate a request body; on failure answer 400 with the first problem and return undefined. */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown, res: Response): z.infer<S> | undefined {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message ?? "invalid request" });
    return undefined;
  }
  return result.data;
}

/** Map a failure talking to the agent service onto an honest HTTP status. */
export function sendAgentError(err: unknown, res: Response, log: Logger): void {
  if (!(err instanceof AgentError)) throw err;
  if (err.kind === "timeout") return void res.status(504).json({ error: "the assessment service timed out" });
  if (err.kind === "unreachable") {
    log.error({ err: err.message }, "agent unreachable");
    return void res.status(502).json({ error: "assessment service unavailable" });
  }
  // 503 means the audit log refused the write: the reviewer must be told the
  // decision was NOT recorded, and why.
  if (err.status === 503) return void res.status(503).json({ error: err.message });
  if (err.status === 404 || err.status === 409) return void res.status(err.status).json({ error: err.message });
  // 401/400 from the agent mean a backend/agent misconfiguration or contract
  // break, not something the user did.
  log.error({ status: err.status, detail: err.message }, "agent rejected a backend request");
  res.status(502).json({ error: "assessment service error" });
}
