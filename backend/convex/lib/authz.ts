/**
 * Authentication and authorization helpers. Every public function calls one
 * of these first; there is no implicit access anywhere.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

export async function requireUserId(ctx: AnyCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) fail("UNAUTHENTICATED", "Sign in first.");
  return userId;
}

export async function getProfile(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<Doc<"profiles"> | null> {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function requireProfile(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<Doc<"profiles">> {
  const p = await getProfile(ctx, userId);
  if (!p) fail("UNAUTHENTICATED", "Profile missing. Sign in again.");
  return p;
}

export function isStaff(profile: Doc<"profiles"> | null): boolean {
  return profile?.role === "arbiter" || profile?.role === "admin";
}

export async function requireArbiter(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<Doc<"profiles">> {
  const p = await requireProfile(ctx, userId);
  if (!isStaff(p)) fail("FORBIDDEN", "Arbiter role required.");
  return p;
}

export type ContractRole = "funder" | "payee";

export function roleIn(contract: Doc<"contracts">, userId: Id<"users">): ContractRole | null {
  if (contract.funderId === userId) return "funder";
  if (contract.payeeId === userId) return "payee";
  return null;
}

export function isParticipant(contract: Doc<"contracts">, userId: Id<"users">): boolean {
  return contract.creatorId === userId || roleIn(contract, userId) !== null;
}

export async function loadContract(ctx: QueryCtx | MutationCtx, id: Id<"contracts">): Promise<Doc<"contracts">> {
  const c = await ctx.db.get(id);
  if (!c) fail("NOT_FOUND", "Contract not found.");
  return c;
}

/**
 * Load a contract the user may see. Participants and staff can read;
 * everyone else gets NOT_FOUND (no existence oracle).
 */
export async function readableContract(ctx: QueryCtx | MutationCtx, id: Id<"contracts">, userId: Id<"users">) {
  const c = await ctx.db.get(id);
  if (!c) fail("NOT_FOUND", "Contract not found.");
  if (isParticipant(c, userId)) return { contract: c, role: roleIn(c, userId), staff: false };
  const p = await getProfile(ctx, userId);
  if (isStaff(p)) return { contract: c, role: null, staff: true };
  fail("NOT_FOUND", "Contract not found.");
}

/** Require that the user plays one of `roles` in the contract. */
export function requireRole(contract: Doc<"contracts">, userId: Id<"users">, roles: ContractRole[]): ContractRole {
  const r = roleIn(contract, userId);
  if (!r || !roles.includes(r)) fail("FORBIDDEN", `Only the ${roles.join(" or ")} can do this.`);
  return r;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function assertEmail(email: string, field = "email"): string {
  const e = normalizeEmail(email);
  if (!EMAIL.test(e) || e.length > 254) fail("INVALID_ARGUMENT", `${field} is not a valid email address.`);
  return e;
}

export function maskEmail(email: string | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`;
}
