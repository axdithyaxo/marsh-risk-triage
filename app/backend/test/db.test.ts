import { describe, expect, it } from "vitest";
import { migrate, openDb } from "../src/db.js";
import { createUser, NewUser, UserExistsError } from "../src/users.js";

const cheap = { N: 2 ** 10, r: 8, p: 1 };
const valid = { email: "A@Example.com", name: "A", role: "underwriter", password: "long enough password" };

describe("database", () => {
  it("applies migrations once and is idempotent", () => {
    const db = openDb(":memory:");
    expect(migrate(db)).toBe(migrate(db));
    const versions = db.prepare("SELECT version FROM schema_migrations").all();
    expect(versions).toHaveLength(1);
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', 'nobody', 'x', 'y')").run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("restricts roles at the schema level", () => {
    const db = openDb(":memory:");
    expect(() =>
      db.prepare("INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES ('1','a@b.c','n','admin','h','t')").run(),
    ).toThrow(/CHECK/);
  });
});

describe("createUser", () => {
  it("normalises the email and never stores the password", async () => {
    const db = openDb(":memory:");
    const u = await createUser(db, valid, cheap);
    expect(u.email).toBe("a@example.com");
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(u.id) as { password_hash: string };
    expect(row.password_hash).not.toContain(valid.password);
  });

  it("rejects a duplicate email, case-insensitively", async () => {
    const db = openDb(":memory:");
    await createUser(db, valid, cheap);
    await expect(createUser(db, { ...valid, email: "a@EXAMPLE.com" }, cheap)).rejects.toThrow(UserExistsError);
  });

  it.each([
    [{ password: "short" }, /12 characters/],
    [{ password: "x".repeat(129) }, /too_big|at most|128/i],
    [{ email: "not-an-email" }, /email/i],
    [{ role: "admin" }, /role|Invalid enum/i],
    [{ name: "  " }, /String must contain at least 1|name/i],
  ])("validates input %j", (override, message) => {
    const result = NewUser.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(message);
  });
});
