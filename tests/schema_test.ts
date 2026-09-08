import { assertEquals } from "jsr:@std/assert@1";
import { client, resetDb, setupDb, teardownDb } from "./test_helper.ts";

Deno.test("test_helper applies schema and boards starts empty", async () => {
  await setupDb();
  const res = await client.queryObject<{ n: number }>(
    "SELECT count(*)::int AS n FROM boards",
  );
  assertEquals(res.rows[0].n, 0);
});

Deno.test("resetDb truncates seeded rows", async () => {
  await resetDb();
  await client.queryArray("INSERT INTO boards (slug) VALUES ('seed-check')");
  await resetDb();
  const res = await client.queryObject<{ n: number }>(
    "SELECT count(*)::int AS n FROM boards",
  );
  assertEquals(res.rows[0].n, 0);
  await teardownDb();
});
