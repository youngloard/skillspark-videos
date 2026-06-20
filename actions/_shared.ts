/**
 * Shared types/helpers for Server Actions.
 *
 * Why a separate file:
 * - Every action file needs the same `R<T>` shape and the same "bail out" helper.
 *   `bad()` returns the failure-only branch, which is assignable to `R<T>` for
 *   any T — so we can `return bad("…")` from actions that promise R<{id:string}>
 *   without losing type safety.
 * - The auth gate (`requireAdmin`) is run by ~32 actions; `withAdmin` wraps the
 *   try/catch so each action's body stays focused on its real work.
 */

import type { Admin } from "@prisma/client";
import { requireAdmin, AuthError } from "@/lib/authorization";

export type Failure = { ok: false; error: string };
export type Success<T = unknown> = { ok: true; data?: T };
export type R<T = unknown> = Success<T> | Failure;

/** Same as R, but `data` is required on the success branch — for actions that
 *  always return a payload the caller wants to read. */
export type RD<T> = { ok: true; data: T } | Failure;

export function bad(msg: string): Failure {
  return { ok: false, error: msg };
}

/**
 * Wraps an admin-only action body. Maps `AuthError` → `{ ok: false }` so the
 * caller doesn't have to. Non-auth errors propagate (so DB/runtime errors
 * surface as 500s instead of being silently masked as "unauthorized").
 */
export async function withAdmin<T>(
  fn: (admin: Admin) => Promise<R<T>>,
): Promise<R<T>> {
  let admin: Admin;
  try {
    ({ admin } = await requireAdmin());
  } catch (e) {
    if (e instanceof AuthError) return bad(e.message);
    throw e;
  }
  return fn(admin);
}

/** withAdmin for actions whose success branch always carries data. */
export async function withAdminD<T>(
  fn: (admin: Admin) => Promise<RD<T>>,
): Promise<RD<T>> {
  let admin: Admin;
  try {
    ({ admin } = await requireAdmin());
  } catch (e) {
    if (e instanceof AuthError) return bad(e.message);
    throw e;
  }
  return fn(admin);
}
