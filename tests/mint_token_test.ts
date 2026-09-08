import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { mintToken as mint } from "../scripts/mint_token.ts";
import { sha256Hex } from "../api/auth.ts";
import { client, resetDb } from "./app_helper.ts";

Deno.test("mint_token — stores sha256, returns raw once, refuses duplicates", async () => {
  await resetDb();

  const raw = await mint("harri-cli");
  assert(raw.length >= 16);

  const row = await client.queryObject<{ name: string; token_hash: string }>(
    "SELECT name, token_hash FROM api_tokens WHERE name = 'harri-cli'",
  );
  assertEquals(row.rows.length, 1);
  assertEquals(row.rows[0].token_hash, await sha256Hex(raw));

  await assertRejects(() => mint("harri-cli"), Error, "already exists");
});
