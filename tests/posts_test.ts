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

Deno.test("POST /api/posts — auto-creates an unknown board slug", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");

  const res = await request("POST", "/api/posts", {
    token,
    body: { boards: ["brand-new-board"], subject: "hello" },
  });

  assertEquals(res.status, 200);
  assertEquals(res.body.data[0].board_slug, "brand-new-board");
  const board = await client.queryObject(
    "SELECT slug FROM boards WHERE slug = 'brand-new-board'",
  );
  assertEquals(board.rows.length, 1);
});

Deno.test("POST /api/posts — fans out to multiple boards, creating unknown ones", async () => {
  await resetDb();
  await client.queryArray("INSERT INTO boards (slug) VALUES ('hermes-dinner')");
  const token = await mintToken("hermes-dev");

  const res = await request("POST", "/api/posts", {
    token,
    body: { boards: ["hermes-dinner", "hermes-ops"], subject: "standup moved", body: "9am" },
  });

  assertEquals(res.status, 200);
  assertEquals(res.body.data.length, 2);
  const slugs = res.body.data.map((p: { board_slug: string }) => p.board_slug).sort();
  assertEquals(slugs, ["hermes-dinner", "hermes-ops"]);
  for (const p of res.body.data) {
    assertEquals(p.subject, "standup moved");
    assertEquals(p.body, "9am");
  }
  const boards = await client.queryObject<{ n: number }>(
    "SELECT count(*)::int AS n FROM boards",
  );
  assertEquals(boards.rows[0].n, 2);
});

Deno.test("POST /api/posts — validation and auth errors", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  const long = (n: number) => "x".repeat(n);

  const cases: Array<[unknown, number]> = [
    [{ boards: [], subject: "hi" }, 400],
    [{ boards: "hermes-dinner", subject: "hi" }, 400],
    [{ boards: ["hermes-dinner"], subject: "" }, 400],
    [{ boards: ["hermes-dinner"], subject: long(201) }, 400],
    [{ boards: ["hermes-dinner"], subject: "hi", body: long(10001) }, 400],
    [{ boards: ["Bad Slug!"], subject: "hi" }, 400],
  ];
  for (const [body, expected] of cases) {
    const res = await request("POST", "/api/posts", { token, body });
    assertEquals(res.status, expected, `body=${JSON.stringify(body)}`);
    assertEquals(res.body.success, false);
  }

  const noAuth = await request("POST", "/api/posts", {
    body: { boards: ["hermes-dinner"], subject: "hi" },
  });
  assertEquals(noAuth.status, 401);

  const badToken = await request("POST", "/api/posts", {
    token: "hb_garbage",
    body: { boards: ["hermes-dinner"], subject: "hi" },
  });
  assertEquals(badToken.status, 401);

  // Nothing was persisted by any of the rejected requests.
  const posts = await client.queryObject<{ n: number }>(
    "SELECT count(*)::int AS n FROM posts",
  );
  assertEquals(posts.rows[0].n, 0);
});
