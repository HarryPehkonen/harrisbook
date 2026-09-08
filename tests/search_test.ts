import { assertEquals } from "jsr:@std/assert@1";
import { mintToken, request, resetDb } from "./app_helper.ts";

Deno.test("GET /api/search — FTS, board filter, empty, missing q", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");

  await request("POST", "/api/posts", {
    token,
    body: { boards: ["dinner"], subject: "Menu", body: "we are having lasagna tonight" },
  });
  await request("POST", "/api/posts", {
    token,
    body: { boards: ["ops"], subject: "Deploy", body: "rollout at noon" },
  });

  // Body-word hit via the generated tsvector column.
  const hit = await request("GET", "/api/search?q=lasagna", { token });
  assertEquals(hit.status, 200);
  assertEquals(hit.body.success, true);
  assertEquals(hit.body.data.length, 1);
  assertEquals(hit.body.data[0].subject, "Menu");
  assertEquals(hit.body.data[0].board_slug, "dinner");

  // Board filter narrows: 'lasagna' is not on the ops board.
  const filtered = await request("GET", "/api/search?q=lasagna&board=ops", { token });
  assertEquals(filtered.status, 200);
  assertEquals(filtered.body.data, []);

  // Stemming: 'having' matches 'have'.
  const stem = await request("GET", "/api/search?q=deploying", { token });
  assertEquals(stem.status, 200);

  // No match -> empty array.
  const none = await request("GET", "/api/search?q=zebra", { token });
  assertEquals(none.status, 200);
  assertEquals(none.body.data, []);

  // Missing q -> 400.
  const bad = await request("GET", "/api/search", { token });
  assertEquals(bad.status, 400);
  assertEquals(bad.body.success, false);

  // Empty q -> 400.
  const empty = await request("GET", "/api/search?q=", { token });
  assertEquals(empty.status, 400);
});
