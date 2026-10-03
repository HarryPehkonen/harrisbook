import { assert, assertEquals } from "jsr:@std/assert@1";
import { mintToken, request, resetDb } from "./app_helper.ts";

Deno.test("POST /api/posts — mentions parsed from subject and body, normalized + deduped", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  const res = await request("POST", "/api/posts", {
    token,
    body: {
      boards: ["general"],
      subject: "@hermes-pi: verify X",
      body: "cc @Harri and @hermes-pi please",
    },
  });
  assertEquals(res.status, 200);
  assertEquals(res.body.data[0].mentions, ["harri", "hermes-pi"]);
});

Deno.test("mentions — word boundary: @hermes-pi-extra does NOT match hermes-pi", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  await request("POST", "/api/posts", {
    token,
    body: { boards: ["general"], subject: "@hermes-pi-extra check this" },
  });

  const exact = await request("GET", "/api/mentions?for=hermes-pi", { token });
  assertEquals(exact.status, 200);
  assertEquals(exact.body.data, []);

  const extra = await request("GET", "/api/mentions?for=hermes-pi-extra", { token });
  assertEquals(extra.status, 200);
  assertEquals(extra.body.data.length, 1);
  assertEquals(extra.body.data[0].subject, "@hermes-pi-extra check this");
});

Deno.test("mentions — unknown handles stored verbatim (no validation against tokens)", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  const res = await request("POST", "/api/posts", {
    token,
    body: { boards: ["general"], subject: "ping @nobody-special now" },
  });
  assertEquals(res.body.data[0].mentions, ["nobody-special"]);

  const r = await request("GET", "/api/mentions?for=nobody-special", { token });
  assertEquals(r.body.data.length, 1);
});

Deno.test("mentions — email addresses are not mentions", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  const res = await request("POST", "/api/posts", {
    token,
    body: { boards: ["general"], subject: "email harry.pehkonen@gmail.com about it" },
  });
  assertEquals(res.body.data[0].mentions, []);
});

Deno.test("GET /api/mentions — envelope, newest-first default, ascending after, auth + validation", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  const first = await request("POST", "/api/posts", {
    token,
    body: { boards: ["general"], subject: "@hermes-pi one" },
  });
  const firstId = first.body.data[0].id;
  const second = await request("POST", "/api/posts", {
    token,
    body: { boards: ["ops"], subject: "@hermes-pi two" },
  });
  const secondId = second.body.data[0].id;

  const all = await request("GET", "/api/mentions?for=hermes-pi", { token });
  assertEquals(all.status, 200);
  assertEquals(all.body.success, true);
  assertEquals(all.body.data.length, 2);
  assertEquals(all.body.data.map((p: { id: number }) => p.id), [secondId, firstId]);

  const after = await request("GET", `/api/mentions?for=hermes-pi&after=${firstId}`, { token });
  assertEquals(after.body.data.map((p: { subject: string }) => p.subject), ["@hermes-pi two"]);

  const upper = await request("GET", "/api/mentions?for=HERMES-PI", { token });
  assertEquals(upper.body.data.length, 2);

  assertEquals((await request("GET", "/api/mentions", { token })).status, 400);
  assertEquals((await request("GET", "/api/mentions?for=hermes-pi")).status, 401);
});

Deno.test("PUT /api/posts/:id — mentions re-parsed from the new subject+body", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  const c = await request("POST", "/api/posts", {
    token,
    body: { boards: ["general"], subject: "@hermes-pi please", body: "no one else" },
  });
  const id = c.body.data[0].id;
  assertEquals(c.body.data[0].mentions, ["hermes-pi"]);

  const upd = await request("PUT", `/api/posts/${id}`, {
    token,
    body: { subject: "resolved, thanks" },
  });
  assertEquals(upd.body.data.mentions, []);

  const upd2 = await request("PUT", `/api/posts/${id}`, {
    token,
    body: { body: "actually @hermes-ops handles this" },
  });
  assertEquals(upd2.body.data.mentions, ["hermes-ops"]);
});

Deno.test("mentions — present on every post-returning route (board list, poll, search)", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");
  await request("POST", "/api/posts", {
    token,
    body: { boards: ["general"], subject: "alpha @hermes-pi ping", body: "content" },
  });

  const newest = await request("GET", "/api/boards/general/posts", { token });
  assertEquals(newest.body.data[0].mentions, ["hermes-pi"]);

  const poll = await request("GET", "/api/boards/general/posts?after=0", { token });
  assertEquals(poll.body.data[0].mentions, ["hermes-pi"]);

  const search = await request("GET", "/api/search?q=alpha", { token });
  assert(Array.isArray(search.body.data[0].mentions));
  assertEquals(search.body.data[0].mentions, ["hermes-pi"]);
});
