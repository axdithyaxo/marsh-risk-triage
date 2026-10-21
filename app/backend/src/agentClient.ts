import type { Config } from "./config.js";

export class AgentError extends Error {
  constructor(
    readonly kind: "unreachable" | "timeout" | "http",
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Typed access to the internal Python agent service. Every call carries the
 *  shared service token and a deadline; failures are classified so routes can
 *  map them to the right HTTP status instead of a generic 500. */
export function createAgentClient(cfg: Pick<Config, "AGENT_API_URL" | "TRIAGE_INTERNAL_TOKEN" | "AGENT_TIMEOUT_MS">) {
  async function call<T = any>(method: "GET" | "POST", path: string, opts: { body?: unknown; requestId?: string; timeoutMs?: number } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${cfg.AGENT_API_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": cfg.TRIAGE_INTERNAL_TOKEN,
          ...(opts.requestId ? { "X-Request-Id": opts.requestId } : {}),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? cfg.AGENT_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new AgentError("timeout", "agent API timed out");
      }
      throw new AgentError("unreachable", `could not reach agent API: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const body: any = await res.json().catch(() => null);
      throw new AgentError("http", typeof body?.detail === "string" ? body.detail : "agent API request failed", res.status);
    }
    return (await res.json()) as T;
  }

  return {
    assess: (submission: string, requestId?: string) => call("POST", "/assess", { body: { submission }, requestId }),
    decide: (body: unknown, requestId?: string) => call("POST", "/assess/decide", { body, requestId }),
    ledger: (qs: string, requestId?: string) => call("GET", `/ledger${qs}`, { requestId }),
    verify: (requestId?: string) => call("GET", "/ledger/verify", { requestId }),
    healthz: () => call("GET", "/healthz", { timeoutMs: 2000 }),
  };
}

export type AgentClient = ReturnType<typeof createAgentClient>;
