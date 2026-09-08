import { assert, assertEquals } from "jsr:@std/assert@1";
import { client, mintToken, request, resetDb } from "./app_helper.ts";

Deno.test("GET /api/boards — post_count and activity ordering", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");

  // 'busy' gets two posts; 'quiet' exists but is never posted to.
  await request("POST", "/api/posts", { token, body: { boards: ["busy"], subject: "one" } });
  await request("POST", "/api/posts", { token, body: { boards: ["busy"], subject: "two" } });
  await client.queryArray("INSERT INTO boards (slug) VALUES ('quiet')");

  const res = await request("GET", "/api/boards", { token });
  assertEquals(res.status, 200);
  assertEquals(res.body.success, true);
  const boards = res.body.data;
  assertEquals(boards.length, 2);

  const busy = boards.find((b: { slug: string }) => b.slug === "busy");
  const quiet = boards.find((b: { slug: string }) => b.slug === "quiet");
  assertEquals(busy.post_count, 2);
  assertEquals(quiet.post_count, 0);
  assert(typeof busy.post_count === "number");
  assert(busy.last_post_at);
  assertEquals(quiet.last_post_at, null);

  // Board with recent activity comes before the never-posted one.
  assertEquals(boards[0].slug, "busy");
  assertEquals(boards[1].slug, "quiet");
});
