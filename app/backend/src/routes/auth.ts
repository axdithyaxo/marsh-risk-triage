import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { cookieName, requireAuth } from "../middleware.js";
import { DUMMY_HASH, verifyPassword } from "../password.js";
import { createSession, destroySession } from "../sessions.js";
import { findLoginUser } from "../users.js";
import { parseBody } from "./http.js";

const Login = z.object({
  email: z.string().trim().toLowerCase().min(1, "email and password are required").max(200),
  password: z.string().min(1, "email and password are required").max(128),
});

export function createAuthRouter({ config, db, logger }: Deps) {
  const router = Router();
  const name = cookieName(config);

  // Per IP+email so one attacker can't lock a victim out from everywhere, plus
  // a looser per-IP ceiling to blunt credential stuffing across many emails.
  // In-memory: correct for one instance; a shared store is needed to scale out.
  const perAccount = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.LOGIN_RATE_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? "").toLowerCase()}`,
    handler: (_req, res) => void res.status(429).json({ error: "too many login attempts, try again later" }),
  });
  const perIp = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.LOGIN_RATE_MAX * 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => void res.status(429).json({ error: "too many login attempts, try again later" }),
  });

  router.post("/login", perIp, perAccount, async (req, res) => {
    const body = parseBody(Login, req.body, res);
    if (!body) return;

    const user = findLoginUser(db, body.email);
    // Always spend the hashing time, and always give the same answer, so
    // neither the response nor its timing says whether an account exists.
    const ok = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || user.disabled || !ok) {
      logger.warn({ ip: req.ip, user_id: user?.id ?? null }, "login failed");
      return void res.status(401).json({ error: "invalid email or password" });
    }

    const { token, expiresAt } = createSession(db, user.id, config.SESSION_TTL_HOURS);
    res.cookie(name, token, {
      httpOnly: true, // not readable by page scripts, so XSS can't exfiltrate it
      sameSite: "lax",
      secure: config.COOKIE_SECURE,
      path: "/",
      expires: expiresAt,
    });
    logger.info({ user_id: user.id }, "login");
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  router.post("/logout", (req, res) => {
    const token = req.cookies?.[name];
    if (typeof token === "string" && token) destroySession(db, token);
    res.clearCookie(name, { httpOnly: true, sameSite: "lax", secure: config.COOKIE_SECURE, path: "/" });
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
