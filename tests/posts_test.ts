import { assert, assertEquals } from "jsr:@std/assert@1";
import { client, mintToken, request, resetDb } from "./app_helper.ts";

Deno.test("POST /api/posts — happy path on an existing board", async () => {
  await resetDb();
  await client.queryArray("INSERT INTO boards (slug) VALUES ('hermes-dinner')");
  const token = await mintToken("hermes-dev");

  const res = await request("POST", "/api/posts", {
    token,
    body: { boards: ["hermes-dinner"], subject: "Dinner at 7", body: "bring wine" },
  });

  assertEquals(res.status, 200);
  assertEquals(res.body.success, true);
  assert(Array.isArray(res.body.data));
  assertEquals(res.body.data.length, 1);
  const post = res.body.data[0];
  assertEquals(post.board_slug, "hermes-dinner");
  assertEquals(post.originator, "hermes-dev");
  assertEquals(post.subject, "Dinner at 7");
  assertEquals(post.body, "bring wine");
  assert(typeof post.id === "number");
  assert(post.created_at);
});
