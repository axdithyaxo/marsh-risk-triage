import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/password.js";

const cheap = { N: 2 ** 10, r: 8, p: 1 };

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("correct horse battery", cheap);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("correct horse batter", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("never stores the password and salts every hash", async () => {
    const a = await hashPassword("same password here", cheap);
    const b = await hashPassword("same password here", cheap);
    expect(a).not.toContain("same password here");
    expect(a).not.toBe(b); // different salts
    expect(await verifyPassword("same password here", b)).toBe(true);
  });

  it("records its cost parameters so they can be raised later", async () => {
    const h = await hashPassword("pw pw pw pw pw pw", cheap);
    expect(h.split("$").slice(0, 4)).toEqual(["scrypt", "1024", "8", "1"]);
  });

  it.each(["", "garbage", "bcrypt$1$2$3$4$5", "scrypt$1024$8$1$onlysalt"])("rejects a malformed stored hash %j", async (stored) => {
    expect(await verifyPassword("anything", stored)).toBe(false);
  });

  it("treats Unicode-equivalent passwords as equal (NFKC)", async () => {
    const h = await hashPassword("passéword-long", cheap); // precomposed é
    expect(await verifyPassword("passéword-long", h)).toBe(true); // e + combining accent
  });
});
