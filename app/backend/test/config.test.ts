import { describe, expect, it } from "vitest";
import { ConfigError, DEV_TOKEN, loadConfig } from "../src/config.js";

const prod = {
  APP_ENV: "production",
  TRIAGE_INTERNAL_TOKEN: "t".repeat(40),
  COOKIE_SECURE: "true",
  ALLOWED_ORIGIN: "https://triage.example.com",
};

describe("loadConfig", () => {
  it("has safe local defaults", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ APP_ENV: "development", PORT: 4000, COOKIE_SECURE: false, SEED_DEMO_USERS: false, SESSION_TTL_HOURS: 8 });
  });

  it("coerces numbers and flags from strings", () => {
    const c = loadConfig({ PORT: "5000", COOKIE_SECURE: "true", SESSION_TTL_HOURS: "2" });
    expect(c).toMatchObject({ PORT: 5000, COOKIE_SECURE: true, SESSION_TTL_HOURS: 2 });
  });

  it.each([
    [{ PORT: "banana" }],
    [{ PORT: "70000" }],
    [{ APP_ENV: "staging" }],
    [{ AGENT_API_URL: "not a url" }],
    [{ COOKIE_SECURE: "yes" }],
    [{ SESSION_TTL_HOURS: "0" }],
  ])("rejects an invalid value %j with a clear error", (env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it("accepts a correct production configuration", () => {
    expect(loadConfig(prod).APP_ENV).toBe("production");
  });

  it.each([
    ["the default internal token", { TRIAGE_INTERNAL_TOKEN: DEV_TOKEN }, /public development default/],
    ["a short internal token", { TRIAGE_INTERNAL_TOKEN: "short" }, /at least 32/],
    ["insecure cookies", { COOKIE_SECURE: "false" }, /COOKIE_SECURE/],
    ["a non-https origin", { ALLOWED_ORIGIN: "http://triage.example.com" }, /https/],
    ["demo user seeding", { SEED_DEMO_USERS: "true" }, /SEED_DEMO_USERS/],
  ])("production refuses %s", (_name, override, message) => {
    expect(() => loadConfig({ ...prod, ...override })).toThrow(message);
  });

  it("reports every production problem at once", () => {
    expect(() => loadConfig({ APP_ENV: "production" })).toThrow(/TRIAGE_INTERNAL_TOKEN.*COOKIE_SECURE.*https/);
  });
});
