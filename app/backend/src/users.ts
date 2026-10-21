import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";
import { hashPassword } from "./password.js";

export const ROLES = ["underwriter", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface UserRow extends User {
  password_hash: string;
  disabled: number;
}

export const NewUser = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
  password: z.string().min(12, "password must be at least 12 characters").max(128),
});

export class UserExistsError extends Error {}

export async function createUser(db: Db, input: unknown, cost?: { N: number; r: number; p: number }): Promise<User> {
  const u = NewUser.parse(input);
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(u.email)) throw new UserExistsError("a user with that email already exists");
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, u.email, u.name, u.role, await hashPassword(u.password, cost), new Date().toISOString(),
  );
  return { id, email: u.email, name: u.name, role: u.role };
}

export function findLoginUser(db: Db, email: string): (User & { password_hash: string; disabled: boolean }) | undefined {
  const row = db.prepare("SELECT id, email, name, role, password_hash, disabled FROM users WHERE email = ?").get(email) as UserRow | undefined;
  return row && { ...row, disabled: row.disabled === 1 };
}

export function countUsers(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}
