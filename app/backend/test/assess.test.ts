import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

// The backend's only dependency is the Python agent API, reached with the
// global fetch(). Stubbing it lets every route be tested without a model.
function stubAgent(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /health", () => {
  it("reports ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /api/assess", () => {
  it.each([{}, { submission: "" }, { submission: "   \n " }])(
    "rejects a missing or blank submission with 400 (%j)",
    async (body) => {
      const fetchMock = stubAgent(200, {});
      const res = await request(app).post("/api/assess").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/submission is required/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("proxies the agent's response through unchanged", async () => {
    const agentBody = { status: "needs_review", assessment_id: "abc123", model_confidence: 0.8 };
    const fetchMock = stubAgent(200, agentBody);

    const res = await request(app).post("/api/assess").send({ submission: "Office, Cork." });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(agentBody);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/assess$/);
    expect(JSON.parse(init.body)).toEqual({ submission: "Office, Cork." });
  });

  it("returns 502 when the agent API errors", async () => {
    stubAgent(500, { detail: "boom" });
    const res = await request(app).post("/api/assess").send({ submission: "x" });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("agent API request failed");
  });

  it("returns 502 with the cause when the agent API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    const res = await request(app).post("/api/assess").send({ submission: "x" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/could not reach agent API: connect ECONNREFUSED/);
  });
});

describe("POST /api/assess/decide", () => {
  const valid = { assessment_id: "abc123", decision: "bind", rationale: "clean risk" };

  it("requires an assessment_id", async () => {
    const res = await request(app).post("/api/assess/decide").send({ decision: "bind", rationale: "r" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assessment_id/);
  });

  it("only accepts bind or refer", async () => {
    const res = await request(app).post("/api/assess/decide").send({ ...valid, decision: "approve" });
    expect(res.status).toBe(400);
  });

  it("requires a non-blank rationale", async () => {
    const res = await request(app).post("/api/assess/decide").send({ ...valid, rationale: "  " });
    expect(res.status).toBe(400);
  });

  it("forwards only the id, decision and rationale, never client-supplied evidence", async () => {
    const fetchMock = stubAgent(200, { status: "decided", final_decision: "BIND" });

    const res = await request(app)
      .post("/api/assess/decide")
      .send({ ...valid, model_confidence: 0.01, branch_critical: true, branch_findings_summary: "forged" });

    expect(res.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(valid);
  });

  it("passes an unknown or already-decided assessment through as 404, not 502", async () => {
    stubAgent(404, { detail: "unknown or already-decided assessment_id" });
    const res = await request(app).post("/api/assess/decide").send(valid);
    expect(res.status).toBe(404);
  });

  it("returns 502 when the agent API errors", async () => {
    stubAgent(500, {});
    const res = await request(app).post("/api/assess/decide").send(valid);
    expect(res.status).toBe(502);
  });
});
