/**
 * Harrisbook — HTTP test harness.
 *
 * Builds the real Oak application and drives it via `app.handle()` (no port
 * bound). Provides helpers for seeding PAT tokens and GUI sessions and for
 * issuing JSON requests.
 */

import { createApp } from "../api/main.ts";
import { client, resetDb } from "./test_helper.ts";
import { sha256Hex } from "../api/auth.ts";

const app = createApp();

export { client, resetDb };

export interface ApiResponse {
  status: number;
  body: any;
  headers: Headers;
}

export async function request(
  method: string,
  path: string,
  opts: { token?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  const headers = new Headers(opts.headers ?? {});
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (opts.cookie) headers.set("Cookie", opts.cookie);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.body);
  }
  const res = await app.handle(
    new Request(`http://localhost${path}`, { method, headers, body }),
    { transport: "tcp", hostname: "127.0.0.1", port: 12345 } as any,
  );
  if (!res) return { status: 0, body: null, headers: new Headers() };
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

/** Insert an api_tokens row and return the raw bearer token. */
export async function mintToken(name: string): Promise<string> {
  const raw = `hb_${crypto.randomUUID().replace(/-/g, "")}`;
  const hash = await sha256Hex(raw);
  await client.queryArray(
    "INSERT INTO api_tokens (name, token_hash) VALUES ($1, $2)",
    [name, hash],
  );
  return raw;
}

/** Seed a user + session row; return the Cookie header value. */
export async function seedSession(
  email: string,
  opts: { expired?: boolean } = {},
): Promise<string> {
  const userRes = await client.queryObject<{ user_id: number }>(
    `INSERT INTO users (email, display_name, role, last_login)
     VALUES ($1, $1, 'admin', now())
     ON CONFLICT (email) DO UPDATE SET last_login = now()
     RETURNING user_id`,
    [email],
  );
  const userId = userRes.rows[0].user_id;
  const raw = `sess_${crypto.randomUUID().replace(/-/g, "")}`;
  const hash = await sha256Hex(raw);
  const expires = opts.expired
    ? new Date(Date.now() - 1000).toISOString()
    : new Date(Date.now() + 86_400_000).toISOString();
  await client.queryArray(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hash, userId, expires],
  );
  return `hb_session=${raw}`;
}
