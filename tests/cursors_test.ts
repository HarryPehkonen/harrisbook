import { assert, assertEquals } from "jsr:@std/assert@1";
import { mintToken, request, resetDb, seedSession } from "./app_helper.ts";

Deno.test("read cursor — advance to upto_id, unread 0, then a new post shows 1", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  let lastId = 0;
  for (let i = 0; i < 3; i++) {
    const r = await request("POST", "/api/posts", {
      token,
      body: { boards: ["general"], subject: `p${i}` },
    });
    lastId = r.body.data[0].id;
  }

  const read = await request("POST", "/api/read", {
    token,
    body: { boards: ["general"], upto_id: lastId },
  });
  assertEquals(read.status, 200);
  assertEquals(read.body.success, true);

  const unread = await request("GET", "/api/unread", { token });
  assertEquals(unread.status, 200);
  const g = unread.body.data.find((b: { slug: string }) => b.slug === "general");
  assertEquals(g.last_id, lastId);
  assertEquals(g.new_count, 0);

  const more = await request("POST", "/api/posts", {
    token,
    body: { boards: ["general"], subject: "new" },
  });
  const newer = more.body.data[0].id;
  assert(newer > lastId);

  const unread2 = await request("GET", "/api/unread", { token });
  const g2 = unread2.body.data.find((b: { slug: string }) => b.slug === "general");
  assertEquals(g2.last_id, lastId);
  assertEquals(g2.new_count, 1);
});

Deno.test("read cursor — token isolation and never-backwards upto_id", async () => {
  await resetDb();
  const a = await mintToken("token-a");
  const b = await mintToken("token-b");
  let lastId = 0;
  for (let i = 0; i < 2; i++) {
    const r = await request("POST", "/api/posts", {
      token: a,
      body: { boards: ["general"], subject: `p${i}` },
    });
    lastId = r.body.data[0].id;
  }

  await request("POST", "/api/read", {
    token: a,
    body: { boards: ["general"], upto_id: lastId },
  });

  // token b's cursor is untouched by token a's read
  const ub = await request("GET", "/api/unread", { token: b });
  const gb = ub.body.data.find((x: { slug: string }) => x.slug === "general");
  assertEquals(gb.last_id, 0);
  assertEquals(gb.new_count, 2);

  // b advances independently
  await request("POST", "/api/read", { token: b, body: { boards: ["general"], upto_id: 1 } });
  const ua = await request("GET", "/api/unread", { token: a });
  assertEquals(ua.body.data.find((x: { slug: string }) => x.slug === "general").last_id, lastId);

  // a tries to move backwards to 1 — the cursor stays at lastId
  await request("POST", "/api/read", { token: a, body: { boards: ["general"], upto_id: 1 } });
  const ua2 = await request("GET", "/api/unread", { token: a });
  const ga2 = ua2.body.data.find((x: { slug: string }) => x.slug === "general");
  assertEquals(ga2.last_id, lastId);
  assertEquals(ga2.new_count, 0);
});

Deno.test("read cursor — auth, validation, and session actors rejected", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");

  assertEquals(
    (await request("POST", "/api/read", { body: { boards: ["general"], upto_id: 1 } })).status,
    401,
  );
  assertEquals((await request("GET", "/api/unread")).status, 401);
  assertEquals(
    (await request("POST", "/api/read", { token, body: { boards: [], upto_id: 1 } })).status,
    400,
  );
  assertEquals(
    (await request("POST", "/api/read", { token, body: { boards: ["general"] } })).status,
    400,
  );
  assertEquals(
    (await request("POST", "/api/read", { token, body: { boards: ["general"], upto_id: "x" } }))
      .status,
    400,
  );
  assertEquals(
    (await request("POST", "/api/read", { token, body: { boards: ["Bad Slug!"], upto_id: 1 } }))
      .status,
    400,
  );

  // A GUI session has no token identity — cursors are per token.
  const cookie = await seedSession("harri@example.com");
  assertEquals(
    (await request("POST", "/api/read", { cookie, body: { boards: ["general"], upto_id: 1 } }))
      .status,
    403,
  );
  assertEquals((await request("GET", "/api/unread", { cookie })).status, 403);
});
