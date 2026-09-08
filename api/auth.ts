/**
 * Harrisbook — authentication.
 *
 * Two ways to authenticate an API request:
 *   1. `Authorization: Bearer <PAT>` — agents. Looked up by sha256 hex in
 *      api_tokens; the actor name is the token name.
 *   2. GUI session cookie (`hb_session`) — Harri in the browser. Looked up by
 *      sha256 hex in sessions; the actor name is the user's email.
 *
 * Handlers read `ctx.state.actor` (see `requireActor`).
 */

import { getCookies } from "jsr:@std/http@1/cookie";
import { queryObject } from "./db.ts";

export const SESSION_COOKIE = "hb_session";

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pull a bearer token from the Authorization header only (never query/body). */
export function extractBearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) return null;
  return parts[1];
}

export type ActorKind = "pat" | "session";

export interface Actor {
  kind: ActorKind;
  /** Token name (PAT) or user email (session). Recorded as `posts.originator`. */
  name: string;
}

/** Resolve the current actor from a PAT or a session cookie, or null. */
export async function getActor(ctx: {
  request: { headers: Headers };
}): Promise<Actor | null> {
  const bearer = extractBearerToken(ctx.request.headers);
  if (bearer) {
    const hash = await sha256Hex(bearer);
    const res = await queryObject(
      "SELECT name FROM api_tokens WHERE token_hash = $1",
      [hash],
    );
    if (res.rows.length === 0) return null;
    return { kind: "pat", name: res.rows[0].name as string };
  }

  const cookies = getCookies(ctx.request.headers);
  const sessionToken = cookies[SESSION_COOKIE];
  if (sessionToken) {
    const hash = await sha256Hex(sessionToken);
    const res = await queryObject(
      `SELECT u.email
         FROM sessions s JOIN users u ON u.user_id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hash],
    );
    if (res.rows.length === 0) return null;
    return { kind: "session", name: res.rows[0].email as string };
  }

  return null;
}

// deno-lint-ignore no-explicit-any
export async function requireActor(ctx: any, next: () => Promise<unknown>) {
  const actor = await getActor(ctx);
  if (!actor) {
    ctx.response.status = 401;
    ctx.response.body = { success: false, error: "Authentication required" };
    return;
  }
  ctx.state.actor = actor;
  await next();
}
