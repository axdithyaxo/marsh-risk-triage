import request from "supertest";
import { describe, expect, it } from "vitest";
import { makeCtx, ORIGIN } from "./helpers.js";

describe("access control", () => {
  it.each([
    ["post", "/api/assess"],
    ["post", "/api/assess/decide"],
    ["get", "/api/assessments"],
    ["get", "/api/assessments/abc"],
    ["get", "/api/ledger"],
    ["get", "/api/ledger/verify"],
  ])("%s %s requires authentication", async (method, path) => {
    const ctx = await makeCtx();
    const req = (request(ctx.app) as any)[method](path).set("Origin", ORIGIN);
    const res = await (method === "post" ? req.send({}) : req);
    expect(res.status).toBe(401);
    expect(ctx.agent.fetchMock).not.toHaveBeenCalled(); // never reached the agent
  });

  it("auditors can read but cannot create or decide", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("aud@example.com", "auditor");
    const a = await ctx.login("aud@example.com");
    expect((await ctx.post(a, "/api/assess", { submission: "x" })).status).toBe(403);
    expect((await ctx.post(a, "/api/assess/decide", { assessment_id: "x", decision: "bind", rationale: "r" })).status).toBe(403);
    expect((await a.get("/api/assessments")).status).toBe(200);
    expect((await a.get("/api/ledger")).status).toBe(200);
    expect((await a.get("/api/ledger/verify")).status).toBe(200);
    expect(ctx.agent.calls("POST /assess")).toHaveLength(0);
  });

  it("underwriters can work but cannot read the audit ledger", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const a = await ctx.login("uw@example.com");
    expect((await a.get("/api/ledger")).status).toBe(403);
    expect((await a.get("/api/ledger/verify")).status).toBe(403);
    expect((await ctx.post(a, "/api/assess", { submission: "Office, Cork." })).status).toBe(200);
  });
});
