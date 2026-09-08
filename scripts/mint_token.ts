/**
 * Harrisbook — mint an API token for an agent profile.
 *
 *   deno run --allow-net --allow-env --allow-read scripts/mint_token.ts <name>
 *
 * Connects to DATABASE_URL, stores only sha256(token) hex, and prints the raw
 * token exactly once. Refuses to overwrite an existing name.
 */

import { getClient } from "../api/db.ts";
import { sha256Hex } from "../api/auth.ts";

const TOKEN_PREFIX = "hb_";

function generateToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return TOKEN_PREFIX +
    Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Insert an api_tokens row for `name` and return the raw token (once). */
export async function mintToken(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("token name is required");

  const client = await getClient();
  const existing = await client.queryArray(
    "SELECT 1 FROM api_tokens WHERE name = $1",
    [trimmed],
  );
  if (existing.rows.length > 0) {
    throw new Error(`a token named "${trimmed}" already exists — pick another name`);
  }

  const raw = generateToken();
  await client.queryArray(
    "INSERT INTO api_tokens (name, token_hash) VALUES ($1, $2)",
    [trimmed, await sha256Hex(raw)],
  );
  return raw;
}

if (import.meta.main) {
  const name = Deno.args[0];
  if (!name) {
    console.error("usage: deno run --allow-net --allow-env --allow-read scripts/mint_token.ts <name>");
    Deno.exit(2);
  }
  try {
    const raw = await mintToken(name);
    console.log(`Token minted for "${name}".`);
    console.log(`Raw token (shown once): ${raw}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }
  Deno.exit(0);
}
