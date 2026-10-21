import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { lookupSession } from "./sessions.js";
import type { Role, User } from "./users.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// `__Host-` pins the cookie to this exact host over HTTPS with Path=/ (no
// subdomain overwrite), but browsers only accept it with Secure, so plain-HTTP
// development uses a normal name.
export const cookieName = (cfg: Pick<Config, "COOKIE_SECURE">) => (cfg.COOKIE_SECURE ? "__Host-sid" : "sid");

/** Attach req.user if the request carries a live session. Never rejects:
 *  routes decide whether they need a user. */
export function authenticate(db: Db, cfg: Pick<Config, "COOKIE_SECURE">): RequestHandler {
  const name = cookieName(cfg);
  return (req, _res, next) => {
    const token = req.cookies?.[name];
    if (typeof token === "string" && token) req.user = lookupSession(db, token);
    next();
  };
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) return void res.status(401).json({ error: "authentication required" });
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user) return void res.status(401).json({ error: "authentication required" });
    if (!roles.includes(req.user.role)) return void res.status(403).json({ error: "you do not have access to this" });
    next();
  };

/** CSRF defence for cookie auth, in addition to SameSite=Lax: a state-changing
 *  request must come from our own frontend origin. A request with no Origin
 *  header is only accepted when it carries no session cookie (a script or curl,
 *  which can't be riding a victim's browser session). */
export function originGuard(cfg: Pick<Config, "ALLOWED_ORIGIN" | "COOKIE_SECURE">): RequestHandler {
  const name = cookieName(cfg);
  const safe = new Set(["GET", "HEAD", "OPTIONS"]);
  return (req: Request, res: Response, next: NextFunction) => {
    if (safe.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin ? origin !== cfg.ALLOWED_ORIGIN : req.cookies?.[name]) {
      return void res.status(403).json({ error: "cross-origin request rejected" });
    }
    next();
  };
}
