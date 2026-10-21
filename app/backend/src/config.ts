import { z } from "zod";

export const DEV_TOKEN = "dev-only-internal-token";
const MIN_SECRET_LEN = 32;

const flag = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_PATH: z.string().min(1).default("./data/app.db"),
  AGENT_API_URL: z.string().url().default("http://localhost:8010"),
  TRIAGE_INTERNAL_TOKEN: z.string().default(DEV_TOKEN),
  ALLOWED_ORIGIN: z.string().url().default("http://localhost:5173"),
  COOKIE_SECURE: flag,
  TRUST_PROXY: flag,
  SESSION_TTL_HOURS: z.coerce.number().positive().max(168).default(8),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(150_000),
  LOGIN_RATE_MAX: z.coerce.number().int().positive().default(10),
  ASSESS_RATE_PER_HOUR: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SEED_DEMO_USERS: flag,
  DEMO_PASSWORD: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {}

/** Parse and validate the environment once, at startup, so a bad deployment
 *  fails immediately with a clear message instead of misbehaving later.
 *  Production mode additionally refuses settings that are unsafe on the
 *  internet (default secrets, cookies without Secure, a non-HTTPS origin). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`invalid configuration: ${issues.join("; ")}`);
  }
  const cfg = parsed.data;

  if (cfg.APP_ENV === "production") {
    const problems: string[] = [];
    if (cfg.TRIAGE_INTERNAL_TOKEN === DEV_TOKEN) problems.push("TRIAGE_INTERNAL_TOKEN is the public development default");
    else if (cfg.TRIAGE_INTERNAL_TOKEN.length < MIN_SECRET_LEN)
      problems.push(`TRIAGE_INTERNAL_TOKEN must be at least ${MIN_SECRET_LEN} characters`);
    if (!cfg.COOKIE_SECURE) problems.push("COOKIE_SECURE must be true");
    if (!cfg.ALLOWED_ORIGIN.startsWith("https://")) problems.push("ALLOWED_ORIGIN must be https");
    if (cfg.SEED_DEMO_USERS) problems.push("SEED_DEMO_USERS must be false");
    if (problems.length) throw new ConfigError(`refusing to start in production: ${problems.join("; ")}`);
  }
  return cfg;
}
