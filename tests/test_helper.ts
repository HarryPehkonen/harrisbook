/**
 * Harrisbook — test DB bootstrap.
 *
 * Points DATABASE_URL at the local test database, applies the schema fresh
 * (dropping existing tables first so every run starts clean), and exposes a
 * shared `client` plus `resetDb()` for truncating between tests.
 */

import { Client } from "jsr:@db/postgres";

const TEST_URL = Deno.env.get("DATABASE_URL_TEST") ??
  "postgres://hb_user:hb_dev_local@localhost:5432/harrisbook_test?sslmode=disable";

// The app's db.ts reads DATABASE_URL — make it talk to the test DB.
Deno.env.set("DATABASE_URL", TEST_URL);

const SCHEMA_DIR = new URL("../db/", import.meta.url);

async function readSql(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(name, SCHEMA_DIR));
}

export const client = new Client(TEST_URL);
let connected = false;
let schemaApplied = false;

async function ensureConnected(): Promise<void> {
  if (connected) return;
  await client.connect();
  connected = true;
}

/** Connect (once) and apply a clean schema (once per process). */
export async function setupDb(): Promise<void> {
  await ensureConnected();
  if (schemaApplied) return;
  await client.queryArray(`
    DROP TABLE IF EXISTS read_cursors CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
    DROP TABLE IF EXISTS user_providers CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS posts CASCADE;
    DROP TABLE IF EXISTS boards CASCADE;
    DROP TABLE IF EXISTS api_tokens CASCADE;
  `);
  await client.queryArray(await readSql("schema.sql"));
  await client.queryArray(await readSql("auth_schema.sql"));
  schemaApplied = true;
}

/** Empty all data tables, keeping the schema. */
export async function resetDb(): Promise<void> {
  await setupDb();
  await client.queryArray(
    `TRUNCATE posts, boards, api_tokens, sessions, user_providers, users, read_cursors RESTART IDENTITY CASCADE`,
  );
}

/** Close the shared client. Safe to call repeatedly; setupDb() reconnects. */
export async function teardownDb(): Promise<void> {
  if (connected) {
    await client.end();
    connected = false;
    schemaApplied = false;
  }
}
