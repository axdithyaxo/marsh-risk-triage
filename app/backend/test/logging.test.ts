import { Writable } from "node:stream";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { makeCtx, ORIGIN, PASSWORD } from "./helpers.js";

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => lines.join("") };
}

describe("logging", () => {
  it("writes JSON lines with a request id and never contains credentials, cookies, submissions or rationales", async () => {
    const logs = captureLogs();
    const ctx = await makeCtx({ LOG_LEVEL: "debug" }, logs.stream);
    await ctx.users.add("uw@example.com", "underwriter");

    await request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "uw@example.com", password: "WRONG-password-SENTINEL" });
    const a = await ctx.login("uw@example.com");
    const assessed = await ctx.post(a, "/api/assess", { submission: "SUBMISSION-SENTINEL ops@example.com" });
    await ctx.post(a, "/api/assess/decide", { assessment_id: assessed.body.assessment_id, decision: "bind", rationale: "RATIONALE-SENTINEL" });
    await a.get("/api/auth/me");

    const text = logs.text();
    expect(text.length).toBeGreaterThan(0);
    for (const line of text.trim().split("\n")) expect(() => JSON.parse(line)).not.toThrow(); // every line is JSON

    for (const secret of ["WRONG-password-SENTINEL", PASSWORD, "SUBMISSION-SENTINEL", "RATIONALE-SENTINEL", "ops@example.com", "sid=", "internal-token"]) {
      expect(text, `log leaked ${secret}`).not.toContain(secret);
    }
    const request_ids = text.trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.req).map((l) => l.req.id);
    expect(request_ids.length).toBeGreaterThan(0);
  });

  it("does not log the healthcheck", async () => {
    const logs = captureLogs();
    const ctx = await makeCtx({ LOG_LEVEL: "debug" }, logs.stream);
    await request(ctx.app).get("/healthz");
    expect(logs.text()).not.toContain("/healthz");
  });
});
