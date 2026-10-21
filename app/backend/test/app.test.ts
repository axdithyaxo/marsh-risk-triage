import request from "supertest";
import { describe, expect, it } from "vitest";
import { makeCtx, ORIGIN } from "./helpers.js";

describe("health", () => {
  it("liveness needs nothing", async () => {
    const ctx = await makeCtx();
    expect((await request(ctx.app).get("/healthz")).body).toEqual({ status: "ok" });
  });

  it("readiness is green only when the database and the agent both answer", async () => {
    const ctx = await makeCtx();
    expect((await request(ctx.app).get("/readyz")).body).toEqual({ db: true, agent: true });

    ctx.agent.set("GET /healthz", () => Promise.reject(new Error("down")));
    const down = await request(ctx.app).get("/readyz");
    expect(down.status).toBe(503);
    expect(down.body).toEqual({ db: true, agent: false });
  });
});

describe("hardening", () => {
  it("sends security headers and does not advertise Express", async () => {
    const ctx = await makeCtx();
    const res = await request(ctx.app).get("/healthz");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });

  it("allows only the configured origin, with credentials", async () => {
    const ctx = await makeCtx();
    const ok = await request(ctx.app).get("/healthz").set("Origin", ORIGIN);
    expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await request(ctx.app).get("/healthz").set("Origin", "https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
  });

  it("answers malformed JSON with a JSON 400, not a stack trace", async () => {
    const ctx = await makeCtx();
    const res = await request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad request" });
  });

  it("rejects an oversized body", async () => {
    const ctx = await makeCtx();
    const res = await request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "a@b.c", password: "x".repeat(200_000) });
    expect(res.status).toBe(413);
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const ctx = await makeCtx();
    const res = await request(ctx.app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not found" });
  });

  it("echoes a request id for correlating logs across services", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const a = await ctx.login("uw@example.com");
    await ctx.post(a, "/api/assess", { submission: "Office, Cork." });
    const [call] = ctx.agent.calls("POST /assess");
    expect((call.init.headers as Record<string, string>)["X-Request-Id"]).toMatch(/\S+/);
  });
});
