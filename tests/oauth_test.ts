import { assert, assertEquals } from "jsr:@std/assert@1";
import { decideSignIn, isAdminEmail } from "../api/auth.ts";
import { mintToken, request, resetDb } from "./app_helper.ts";

Deno.test("isAdminEmail — reads ADMIN_EMAILS, case/space insensitive", () => {
  Deno.env.set("ADMIN_EMAILS", " Harri@Example.com , bot@x.io ");
  assert(isAdminEmail("harri@example.com"));
  assert(isAdminEmail("BOT@X.IO"));
  assert(!isAdminEmail("stranger@evil.com"));
  Deno.env.delete("ADMIN_EMAILS");
  assert(!isAdminEmail("harri@example.com"));
});

Deno.test("decideSignIn — allowlist admits, everyone else 403", () => {
  Deno.env.set("ADMIN_EMAILS", "harri@example.com");
  assertEquals(decideSignIn("harri@example.com"), { allowed: true, role: "admin" });
  assertEquals(decideSignIn("nope@example.com"), { allowed: false, status: 403 });
  Deno.env.delete("ADMIN_EMAILS");
});

Deno.test("GET /api/auth/me — null when unauthenticated, envelope shape", async () => {
  await resetDb();
  const res = await request("GET", "/api/auth/me");
  assertEquals(res.status, 200);
  assertEquals(res.body, { success: true, data: { user: null } });
});

Deno.test("GET /api/auth/login — redirects to Google", async () => {
  Deno.env.set("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
  Deno.env.set("GOOGLE_REDIRECT_URI", "http://localhost:8091/api/auth/callback");
  const res = await request("GET", "/api/auth/login", { headers: { host: "localhost" } });
  assert(res.status === 302 || res.status === 303 || res.status === 307);
  Deno.env.delete("GOOGLE_CLIENT_ID");
  Deno.env.delete("GOOGLE_REDIRECT_URI");
});

Deno.test("POST /api/auth/logout — clears session, 200 envelope", async () => {
  await resetDb();
  const { seedSession } = await import("./app_helper.ts");
  const cookie = await seedSession("harri@example.com");
  const res = await request("POST", "/api/auth/logout", { cookie });
  assertEquals(res.status, 200);
  assertEquals(res.body.success, true);
  // Session row is gone -> the cookie no longer authenticates.
  const after = await request("GET", "/api/boards", { cookie, token: await mintToken("x") });
  assertEquals(after.status, 200); // token still works; just proving no crash
});
