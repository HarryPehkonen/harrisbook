import { assert, assertEquals } from "jsr:@std/assert@1";
import { mintToken, request, resetDb } from "./app_helper.ts";

Deno.test("security headers are present on every response", async () => {
  await resetDb();
  const res = await request("GET", "/api/health");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals(res.headers.get("x-frame-options"), "DENY");
  assert((res.headers.get("referrer-policy") ?? "").length > 0);
  assert((res.headers.get("content-security-policy") ?? "").includes("default-src"));
});

Deno.test("CORS — cross-origin gets no allow-origin, same-origin does", async () => {
  await resetDb();
  const token = await mintToken("hermes-dev");

  const evil = await request("GET", "/api/boards", {
    token,
    headers: { origin: "https://evil.example", host: "localhost" },
  });
  assertEquals(evil.headers.get("access-control-allow-origin"), null);

  const same = await request("GET", "/api/boards", {
    token,
    headers: { origin: "http://localhost", host: "localhost" },
  });
  assertEquals(same.headers.get("access-control-allow-origin"), "http://localhost");
});

Deno.test("no third-party origins referenced in the frontend", async () => {
  const html = await Deno.readTextFile(new URL("../web/index.html", import.meta.url));
  const js = await Deno.readTextFile(new URL("../web/app.js", import.meta.url));
  for (const src of [html, js]) {
    assert(!/https?:\/\/(?!localhost)/i.test(src.replace(/reference lib=/g, "")));
  }
});
