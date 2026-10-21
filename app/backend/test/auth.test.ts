import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { makeCtx, ORIGIN, PASSWORD } from "./helpers.js";

const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[] | undefined)?.[0] ?? "";

describe("login", () => {
  it("signs in and sets an HttpOnly, SameSite=Lax session cookie", async () => {
    const ctx = await makeCtx();
    const u = await ctx.users.add("uw@example.com", "underwriter", "Una Writer");
    const res = await request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "UW@example.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: u.id, email: "uw@example.com", name: "Una Writer", role: "underwriter" } });
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // plain-HTTP development
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
  });

  it("uses a Secure, __Host- prefixed cookie when COOKIE_SECURE is on", async () => {
    const ctx = await makeCtx({ COOKIE_SECURE: "true", ALLOWED_ORIGIN: "https://triage.example.com" });
    await ctx.users.add("uw@example.com", "underwriter");
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .set("Origin", "https://triage.example.com")
      .send({ email: "uw@example.com", password: PASSWORD });
    expect(cookieOf(res)).toMatch(/^__Host-sid=/);
    expect(cookieOf(res)).toMatch(/Secure/i);
  });

  it("stores only a hash of the session token", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const res = await request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "uw@example.com", password: PASSWORD });
    const token = decodeURIComponent(cookieOf(res).split(";")[0].slice("sid=".length));
    const row = ctx.db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.token_hash).not.toContain(token);
  });

  it("gives the same answer for a wrong password, an unknown email and a disabled account", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    await ctx.users.add("off@example.com", "underwriter");
    ctx.db.prepare("UPDATE users SET disabled = 1 WHERE email = 'off@example.com'").run();

    const attempts = await Promise.all(
      [
        { email: "uw@example.com", password: "wrong password here" },
        { email: "nobody@example.com", password: PASSWORD },
        { email: "off@example.com", password: PASSWORD },
      ].map((body) => request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send(body)),
    );
    for (const r of attempts) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: "invalid email or password" });
      expect(cookieOf(r)).toBe("");
    }
  });

  it.each([{}, { email: "a@b.c" }, { password: "x" }, { email: "", password: "" }])("rejects incomplete credentials %j with 400", async (body) => {
    const ctx = await makeCtx();
    const res = await request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send(body);
    expect(res.status).toBe(400);
  });

  it("rate-limits repeated failures per account, without locking out other accounts", async () => {
    const ctx = await makeCtx({ LOGIN_RATE_MAX: "3" });
    await ctx.users.add("victim@example.com", "underwriter");
    await ctx.users.add("other@example.com", "underwriter");
    const attempt = (email: string, password: string) =>
      request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send({ email, password });

    for (let i = 0; i < 3; i++) expect((await attempt("victim@example.com", "wrong password!!")).status).toBe(401);
    const blocked = await attempt("victim@example.com", PASSWORD); // even the right password is refused once limited
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
    expect((await attempt("other@example.com", PASSWORD)).status).toBe(200);
  });
});

describe("session lifecycle", () => {
  it("/me needs a session and then returns the user", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    expect((await request(ctx.app).get("/api/auth/me")).status).toBe(401);
    const a = await ctx.login("uw@example.com");
    const me = await a.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("uw@example.com");
  });

  it("logout invalidates the session server-side, not just in the browser", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const a = await ctx.login("uw@example.com");
    expect((await ctx.post(a, "/api/auth/logout")).status).toBe(204);
    expect((await a.get("/api/auth/me")).status).toBe(401);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("a replayed cookie stops working after logout", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const res = await request(ctx.app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "uw@example.com", password: PASSWORD });
    const cookie = cookieOf(res).split(";")[0];
    expect((await request(ctx.app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    await request(ctx.app).post("/api/auth/logout").set("Cookie", cookie).set("Origin", ORIGIN);
    expect((await request(ctx.app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("sessions expire", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const a = await ctx.login("uw@example.com");
    ctx.db.prepare("UPDATE sessions SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect((await a.get("/api/auth/me")).status).toBe(401);
  });

  it("disabling an account ends its sessions immediately", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const a = await ctx.login("uw@example.com");
    ctx.db.prepare("UPDATE users SET disabled = 1").run();
    expect((await a.get("/api/auth/me")).status).toBe(401);
  });
});

describe("CSRF origin guard", () => {
  it("rejects a state-changing request from another origin", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const res = await request(ctx.app).post("/api/auth/login").set("Origin", "https://evil.example").send({ email: "uw@example.com", password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it("rejects a cookie-bearing state-changing request that has no Origin", async () => {
    const ctx = await makeCtx();
    await ctx.users.add("uw@example.com", "underwriter");
    const a = await ctx.login("uw@example.com");
    expect((await a.post("/api/auth/logout")).status).toBe(403);
  });

  it("does not guard reads", async () => {
    const ctx = await makeCtx();
    expect((await request(ctx.app).get("/healthz").set("Origin", "https://evil.example")).status).toBe(200);
  });
});
