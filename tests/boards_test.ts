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

Deno.test("GET /api/boards/:slug/posts — newest-first, limit respected", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  for (const s of ["a", "b", "c"]) {
    await request("POST", "/api/posts", { token, body: { boards: ["thread"], subject: s } });
  }

  const res = await request("GET", "/api/boards/thread/posts", { token });
  assertEquals(res.status, 200);
  const subjects = res.body.data.map((p: { subject: string }) => p.subject);
  assertEquals(subjects, ["c", "b", "a"]);
  const ids = res.body.data.map((p: { id: number }) => p.id);
  assertEquals([...ids].sort((x, y) => y - x), ids); // descending by id

  const limited = await request("GET", "/api/boards/thread/posts?limit=2", { token });
  assertEquals(limited.body.data.length, 2);
  assertEquals(limited.body.data[0].subject, "c");
});

Deno.test("GET /api/boards/:slug/posts?after= — ascending polling contract", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  for (const s of ["1", "2", "3", "4", "5"]) {
    await request("POST", "/api/posts", { token, body: { boards: ["poll"], subject: s } });
  }
  const all = await request("GET", "/api/boards/poll/posts", { token });
  const ids = all.body.data.map((p: { id: number }) => p.id).sort((a: number, b: number) => a - b);

  const res = await request("GET", `/api/boards/poll/posts?after=${ids[1]}`, { token });
  assertEquals(res.status, 200);
  const got = res.body.data.map((p: { id: number }) => p.id);
  assertEquals(got, [ids[2], ids[3], ids[4]]); // strictly greater than cursor, ascending
  assertEquals(res.body.data.map((p: { subject: string }) => p.subject), ["3", "4", "5"]);
});
