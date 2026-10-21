import { vi } from "vitest";
import request from "supertest";
import { createAgentClient } from "../src/agentClient.js";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createLogger } from "../src/logger.js";
import { createUser, type Role } from "../src/users.js";

export const ORIGIN = "http://localhost:5173";
export const PASSWORD = "correct horse battery staple";
const FAST = { N: 2 ** 10, r: 8, p: 1 }; // cheap scrypt so tests stay fast; production uses the strong default

export const EVIDENCE = {
  branch_findings_summary: "property: LOW; financial: LOW; regulatory: LOW",
  branch_critical: false,
  model_confidence: 0.9,
  property_analysis: '{"risk_level": "LOW", "confidence": 0.9, "finding": "ok"}',
  financial_analysis: '{"risk_level": "LOW", "confidence": 0.9, "finding": "ok"}',
  regulatory_analysis: '{"risk_level": "LOW", "confidence": 0.9, "finding": "ok"}',
  guidelines_consulted: { property: [], financial: [], regulatory: [] },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A stand-in for the Python agent service: records every call and answers
 *  from a table that individual tests can override. */
export function makeAgentStub() {
  let n = 0;
  const handlers: Record<string, Handler> = {
    "POST /assess": () =>
      json({
        status: "needs_review",
        assessment_id: (++n).toString(16).padStart(32, "0"),
        elapsed_seconds: 1.2,
        submission_sha256: "ab".repeat(32),
        submission_redacted: "Office, Cork. Contact [REDACTED_EMAIL].",
        evidence: EVIDENCE,
        evidence_signature: "signature-from-agent",
      }),
    "POST /assess/decide": () =>
      json({ status: "decided", final_decision: "BIND", computed_oversight_level: "PRE_EXECUTION", audit_entry: { seq: 1, entry_hash: "h".repeat(64) } }),
    "GET /ledger": () => json({ count: 0, head_hash: "0".repeat(64), offset: 0, entries: [] }),
    "GET /ledger/verify": () => json({ ok: true, entries: 0, head_hash: "0".repeat(64), error: null }),
    "GET /healthz": () => json({ status: "ok" }),
  };
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? "GET"} ${url.pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected agent call: ${key}`);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    /** Replace one endpoint's behaviour for a test. */
    set(key: string, handler: Handler) {
      handlers[key] = handler;
    },
    json,
    calls: (key: string) =>
      fetchMock.mock.calls
        .filter(([input, init]) => `${init?.method ?? "GET"} ${new URL(String(input)).pathname}` === key)
        .map(([input, init]) => ({ url: new URL(String(input)), init: init as RequestInit, body: init?.body ? JSON.parse(String(init.body)) : undefined })),
  };
}

export async function makeCtx(env: Record<string, string> = {}, logDestination?: Parameters<typeof createLogger>[1]) {
  const config: Config = loadConfig({ APP_ENV: "test", LOG_LEVEL: "silent", ...env });
  const db = openDb(":memory:");
  const logger = createLogger(config, logDestination);
  const agentStub = makeAgentStub();
  const app = createApp({ config, db, logger, agent: createAgentClient(config) });

  const users = {
    async add(email: string, role: Role, name = email.split("@")[0]) {
      return createUser(db, { email, name, role, password: PASSWORD }, FAST);
    },
  };

  /** A supertest agent that is logged in as the given user (cookie jar included). */
  async function login(email: string) {
    const a = request.agent(app);
    const res = await a.post("/api/auth/login").set("Origin", ORIGIN).send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return a;
  }

  /** POST as a browser would: with the frontend's Origin. */
  const post = (a: ReturnType<typeof request.agent>, path: string, body?: unknown) => a.post(path).set("Origin", ORIGIN).send(body as object);

  return { app, db, config, logger, agent: agentStub, users, login, post };
}
