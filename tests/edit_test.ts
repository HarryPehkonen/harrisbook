import { assert, assertEquals } from "jsr:@std/assert@1";
import { client, mintToken, request, resetDb, seedSession } from "./app_helper.ts";

async function makePost(token: string, over: Record<string, unknown> = {}) {
  const res = await request("POST", "/api/posts", {
    token,
    body: { boards: ["b"], subject: "orig subject", body: "orig body", ...over },
  });
  return res.body.data[0];
}

Deno.test("PUT /api/posts/:id — GUI admin session may edit any post", async () => {
  await resetDb();
  const patToken = await mintToken("hermes-dev");
  const post = await makePost(patToken);
  const cookie = await seedSession("harri@example.com");

  const res = await request("PUT", `/api/posts/${post.id}`, {
    cookie,
    body: { subject: "corrected", body: "corrected body" },
  });
  assertEquals(res.status, 200);
  assertEquals(res.body.data.subject, "corrected");
  assertEquals(res.body.data.body, "corrected body");
  assertEquals(res.body.data.id, post.id);
  assertEquals(res.body.data.created_at, post.created_at);
  assert(new Date(res.body.data.updated_at) > new Date(res.body.data.created_at));
});

Deno.test("PUT /api/posts/:id — PAT edits own post, not another's", async () => {
  await resetDb();
  const dev = await mintToken("hermes-dev");
  const ops = await mintToken("hermes-ops");
  const devPost = await makePost(dev);

  const own = await request("PUT", `/api/posts/${devPost.id}`, {
    token: dev,
    body: { subject: "dev fixed it" },
  });
  assertEquals(own.status, 200);
  assertEquals(own.body.data.subject, "dev fixed it");
  assertEquals(own.body.data.body, "orig body");

  const other = await request("PUT", `/api/posts/${devPost.id}`, {
    token: ops,
    body: { subject: "ops meddling" },
  });
  assertEquals(other.status, 403);
});

Deno.test("PUT /api/posts/:id — auth, 404, 400 cases", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  const post = await makePost(token);

  assertEquals((await request("PUT", `/api/posts/${post.id}`, { body: { subject: "x" } })).status, 401);
  assertEquals((await request("PUT", "/api/posts/999999", { token, body: { subject: "x" } })).status, 404);
  assertEquals((await request("PUT", `/api/posts/${post.id}`, { token, body: {} })).status, 400);
  assertEquals(
    (await request("PUT", `/api/posts/${post.id}`, { token, body: { subject: "x".repeat(201) } })).status,
    400,
  );
});

Deno.test("PUT /api/posts/:id — edit re-indexes FTS", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  const post = await makePost(token, { subject: "food", body: "lasagna please" });

  assertEquals((await request("GET", "/api/search?q=lasagna", { token })).body.data.length, 1);

  await request("PUT", `/api/posts/${post.id}`, { token, body: { body: "sushi instead" } });

  assertEquals((await request("GET", "/api/search?q=lasagna", { token })).body.data.length, 0);
  assertEquals((await request("GET", "/api/search?q=sushi", { token })).body.data.length, 1);

  // sanity: stored row really changed
  const row = await client.queryObject<{ body: string }>(
    "SELECT body FROM posts WHERE id = $1",
    [post.id],
  );
  assertEquals(row.rows[0].body, "sushi instead");
});
