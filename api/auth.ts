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

import { Router } from "jsr:@oak/oak";
import { deleteCookie, getCookies, setCookie } from "jsr:@std/http@1/cookie";
import { queryObject } from "./db.ts";

export const SESSION_COOKIE = "hb_session";
const STATE_COOKIE = "hb_oauth_state";
const SESSION_DAYS = 30;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

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
  /**
   * api_tokens.id — set for PAT actors only; read cursors key on it. A GUI
   * session has no token identity, so it stays undefined.
   */
  tokenId?: number;
}

/** Resolve the current actor from a PAT or a session cookie, or null. */
export async function getActor(ctx: {
  request: { headers: Headers };
}): Promise<Actor | null> {
  const bearer = extractBearerToken(ctx.request.headers);
  if (bearer) {
    const hash = await sha256Hex(bearer);
    const res = await queryObject(
      "SELECT id::int AS id, name FROM api_tokens WHERE token_hash = $1",
      [hash],
    );
    if (res.rows.length === 0) return null;
    return { kind: "pat", name: res.rows[0].name as string, tokenId: res.rows[0].id as number };
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

// ---------------------------------------------------------------------------
// Google OAuth (GUI sign-in) — copied from TNGPlaylists api/auth.ts.
// v1: sign-in is allowed ONLY for emails in ADMIN_EMAILS; role stays 'admin'.
// ---------------------------------------------------------------------------

export function getAdminEmails(): Set<string> {
  const raw = Deno.env.get("ADMIN_EMAILS") ?? "";
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().has(email.trim().toLowerCase());
}

export type SignInDecision =
  | { allowed: true; role: "admin" }
  | { allowed: false; status: 403 };

/** Pure allowlist decision — unit-tested in lieu of a live Google round-trip. */
export function decideSignIn(email: string): SignInDecision {
  return isAdminEmail(email) ? { allowed: true, role: "admin" } : { allowed: false, status: 403 };
}

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isHttps(reqUrl: URL, headers: Headers): boolean {
  if (headers.get("x-forwarded-proto") === "https") return true;
  return reqUrl.protocol === "https:";
}

function getClientId(): string {
  const id = Deno.env.get("GOOGLE_CLIENT_ID");
  if (!id) throw new Error("GOOGLE_CLIENT_ID not set");
  return id;
}

function getClientSecret(): string {
  const secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET not set");
  return secret;
}

function getRedirectUri(reqUrl: URL): string {
  return Deno.env.get("GOOGLE_REDIRECT_URI") ??
    `${reqUrl.protocol}//${reqUrl.host}/api/auth/callback`;
}

// Per-IP sliding-window rate limiter for the auth endpoints.
const authAttempts = new Map<string, number[]>();
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX = 30;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (authAttempts.get(ip) ?? []).filter((t) => now - t < AUTH_WINDOW_MS);
  if (hits.length >= AUTH_MAX) {
    authAttempts.set(ip, hits);
    return true;
  }
  hits.push(now);
  authAttempts.set(ip, hits);
  return false;
}

function clientIp(ctx: { request: { headers: Headers } }): string {
  return ctx.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export const authRouter = new Router();

authRouter.get("/api/auth/login", (ctx) => {
  if (rateLimited(clientIp(ctx))) {
    ctx.response.status = 429;
    ctx.response.body = { success: false, error: "Too many requests" };
    return;
  }
  const state = randomToken(16);
  setCookie(ctx.response.headers, {
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps(ctx.request.url, ctx.request.headers),
    maxAge: 600,
    path: "/",
  });
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(ctx.request.url),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  ctx.response.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

authRouter.get("/api/auth/callback", async (ctx) => {
  if (rateLimited(clientIp(ctx))) {
    ctx.response.status = 429;
    ctx.response.body = { success: false, error: "Too many requests" };
    return;
  }
  const url = ctx.request.url;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = getCookies(ctx.request.headers);
  deleteCookie(ctx.response.headers, STATE_COOKIE, { path: "/" });

  if (!code || !state || state !== cookies[STATE_COOKIE]) {
    ctx.response.status = 400;
    ctx.response.body = { success: false, error: "Invalid OAuth state" };
    return;
  }

  const redirectUri = getRedirectUri(url);
  let tokenJson: { access_token?: string; error?: string; error_description?: string } | null;
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: getClientId(),
        client_secret: getClientSecret(),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokenJson = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenJson?.access_token) {
      // Log status + error code only — NEVER the body (it embeds an id_token JWT).
      console.error("OAuth token exchange error:", tokenRes.status, tokenJson?.error ?? "unknown");
      ctx.response.status = 502;
      ctx.response.body = { success: false, error: "Token exchange failed" };
      return;
    }
  } catch {
    ctx.response.status = 502;
    ctx.response.body = { success: false, error: "Token exchange failed" };
    return;
  }

  const userinfoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profile = await userinfoRes.json().catch(() => null);
  if (!userinfoRes.ok || !profile?.email || !profile.email_verified) {
    ctx.response.status = 502;
    ctx.response.body = { success: false, error: "Could not verify Google account" };
    return;
  }

  const email = String(profile.email).toLowerCase();
  const decision = decideSignIn(email);
  if (!decision.allowed) {
    ctx.response.status = 403;
    ctx.response.body = { success: false, error: "This account is not permitted to sign in" };
    return;
  }

  const userRes = await queryObject(
    `INSERT INTO users (email, display_name, picture, role, last_login)
     VALUES ($1, $2, $3, 'admin', now())
     ON CONFLICT (email) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, users.display_name),
       picture = COALESCE(EXCLUDED.picture, users.picture),
       last_login = now()
     RETURNING user_id`,
    [email, profile.name ?? null, profile.picture ?? null],
  );
  const userId = userRes.rows[0].user_id as number;

  await queryObject(
    `INSERT INTO user_providers (user_id, provider, provider_sub)
     VALUES ($1, 'google', $2)
     ON CONFLICT (provider, provider_sub) DO NOTHING`,
    [userId, String(profile.sub ?? "")],
  );

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await queryObject(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
    [tokenHash, userId, expiresAt.toISOString()],
  );

  setCookie(ctx.response.headers, {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps(url, ctx.request.headers),
    maxAge: SESSION_DAYS * 86_400,
    path: "/",
  });
  ctx.response.redirect("/");
});

authRouter.get("/api/auth/me", async (ctx) => {
  const actor = await getActor(ctx);
  const user = actor?.kind === "session" ? { email: actor.name, role: "admin" } : null;
  ctx.response.body = { success: true, data: { user } };
});

authRouter.post("/api/auth/logout", async (ctx) => {
  const cookies = getCookies(ctx.request.headers);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await queryObject(`DELETE FROM sessions WHERE token_hash = $1`, [await sha256Hex(token)]);
  }
  deleteCookie(ctx.response.headers, SESSION_COOKIE, { path: "/" });
  ctx.response.body = { success: true, data: null };
});
