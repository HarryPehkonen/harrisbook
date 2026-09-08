import { assertEquals } from "jsr:@std/assert@1";
import { mintToken, request, resetDb, seedSession } from "./app_helper.ts";

Deno.test("PAT auth — required, valid, invalid; originator recorded", async () => {
  await resetDb();

  // No auth -> 401.
  const anon = await request("GET", "/api/boards");
  assertEquals(anon.status, 401);

  // Garbage token -> 401.
  const bad = await request("GET", "/api/boards", { token: "hb_nope" });
  assertEquals(bad.status, 401);

  // Valid token -> 200, and a post it makes is stamped with the token name.
  const token = await mintToken("hermes-ops");
  const post = await request("POST", "/api/posts", {
    token,
    body: { boards: ["ops"], subject: "hi" },
  });
  assertEquals(post.status, 200);
  assertEquals(post.body.data[0].originator, "hermes-ops");
});

Deno.test("session auth — cookie authenticates, originator = user email", async () => {
  await resetDb();
  const cookie = await seedSession("harri@example.com");

  const res = await request("POST", "/api/posts", {
    cookie,
    body: { boards: ["general"], subject: "from the browser" },
  });
  assertEquals(res.status, 200);
  assertEquals(res.body.data[0].originator, "harri@example.com");

  const boards = await request("GET", "/api/boards", { cookie });
  assertEquals(boards.status, 200);
});

Deno.test("session auth — expired session is rejected", async () => {
  await resetDb();
  const cookie = await seedSession("harri@example.com", { expired: true });
  const res = await request("GET", "/api/boards", { cookie });
  assertEquals(res.status, 401);
});
