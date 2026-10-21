import { describe, expect, it } from "vitest";
import { makeCtx } from "./helpers.js";

async function setup() {
  const ctx = await makeCtx();
  await ctx.users.add("a@example.com", "underwriter");
  await ctx.users.add("b@example.com", "underwriter");
  await ctx.users.add("aud@example.com", "auditor");
  const [a, b, aud] = await Promise.all(["a@example.com", "b@example.com", "aud@example.com"].map((e) => ctx.login(e)));
  const mine = (await ctx.post(a, "/api/assess", { submission: "A's case" })).body.assessment_id as string;
  const theirs = (await ctx.post(b, "/api/assess", { submission: "B's case" })).body.assessment_id as string;
  return { ctx, a, b, aud, mine, theirs };
}

describe("assessment history", () => {
  it("shows an underwriter only their own work", async () => {
    const { a, mine } = await setup();
    const res = await a.get("/api/assessments");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.assessments.map((x: any) => x.assessment_id)).toEqual([mine]);
    expect(res.body.assessments[0]).not.toHaveProperty("owner");
  });

  it("shows an auditor everyone's, with owners", async () => {
    const { aud } = await setup();
    const res = await aud.get("/api/assessments");
    expect(res.body.total).toBe(2);
    expect(res.body.assessments.map((x: any) => x.owner).sort()).toEqual(["a@example.com", "b@example.com"]);
  });

  it("paginates and validates paging", async () => {
    const { aud } = await setup();
    expect((await aud.get("/api/assessments?limit=1")).body.assessments).toHaveLength(1);
    expect((await aud.get("/api/assessments?limit=1&offset=1")).body.assessments).toHaveLength(1);
    expect((await aud.get("/api/assessments?limit=1&offset=2")).body.assessments).toHaveLength(0);
    for (const bad of ["limit=0", "limit=101", "offset=-1", "limit=abc"]) {
      expect((await aud.get(`/api/assessments?${bad}`)).status).toBe(400);
    }
  });

  it("returns one assessment to its owner, without the signature", async () => {
    const { a, mine } = await setup();
    const res = await a.get(`/api/assessments/${mine}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ assessment_id: mine, status: "needs_review", submission_redacted: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toContain("signature");
  });

  it("makes someone else's assessment look exactly like a missing one", async () => {
    const { a, theirs } = await setup();
    const other = await a.get(`/api/assessments/${theirs}`);
    const missing = await a.get("/api/assessments/does-not-exist");
    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });

  it("lets an auditor open any assessment", async () => {
    const { aud, theirs } = await setup();
    const res = await aud.get(`/api/assessments/${theirs}`);
    expect(res.status).toBe(200);
    expect(res.body.owner).toBe("b@example.com");
  });

  it("includes the decision once made", async () => {
    const { ctx, a, mine } = await setup();
    await ctx.post(a, "/api/assess/decide", { assessment_id: mine, decision: "refer", rationale: "needs senior review" });
    const res = await a.get(`/api/assessments/${mine}`);
    expect(res.body).toMatchObject({ status: "decided", decision: "refer", rationale: "needs senior review", audit_seq: 1 });
    expect((await a.get("/api/assessments")).body.assessments[0]).toMatchObject({ status: "decided", decision: "refer" });
  });
});
