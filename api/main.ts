/**
 * Harrisbook — API server.
 *
 * Oak-based. Mirrors the TNGPlaylists conventions: {"success": true, "data": ...}
 * response envelope, env-var config, static frontend served from web/, no build.
 *
 * Run:
 *   DATABASE_URL=postgres://hb_user:***@localhost:5432/harrisbook \
 *   deno run --allow-net --allow-env --allow-read api/main.ts
 */

import { Application, send } from "jsr:@oak/oak";
import { getClient } from "./db.ts";
import { postsRouter } from "./posts.ts";
import { searchRouter } from "./search.ts";

const WEB_DIR = Deno.env.get("WEB_DIR") ??
  new URL("../web/", import.meta.url).pathname;

export function createApp(): Application {
  const app = new Application();

  // Logging
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(
      `${ctx.request.method} ${ctx.request.url.pathname} — ${ctx.response.status} (${ms}ms)`,
    );
  });

  // CORS — same-origin only (frontend is served from this same origin).
  app.use(async (ctx, next) => {
    const origin = ctx.request.headers.get("origin");
    if (origin) {
      const host = ctx.request.headers.get("host");
      if (origin === `https://${host}` || origin === `http://${host}`) {
        ctx.response.headers.set("Access-Control-Allow-Origin", origin);
        ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      }
    }
    if (ctx.request.method === "OPTIONS") {
      ctx.response.status = 204;
      return;
    }
    await next();
  });

  // Error handling
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error("Unhandled error:", err);
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Internal server error" };
    }
  });

  // Health check
  app.use(async (ctx, next) => {
    if (ctx.request.url.pathname === "/api/health") {
      try {
        await (await getClient()).queryArray("SELECT 1");
        ctx.response.body = { success: true, data: { status: "ok", db: "connected" } };
      } catch {
        ctx.response.status = 503;
        ctx.response.body = { success: false, error: "db unavailable" };
      }
      return;
    }
    await next();
  });

  app.use(postsRouter.routes());
  app.use(postsRouter.allowedMethods());
  app.use(searchRouter.routes());
  app.use(searchRouter.allowedMethods());

  // Static frontend
  app.use(async (ctx, next) => {
    if (ctx.request.url.pathname.startsWith("/api/")) {
      await next();
      return;
    }
    const path = ctx.request.url.pathname === "/" ? "index.html" : ctx.request.url.pathname;
    try {
      await send(ctx, path, { root: WEB_DIR });
    } catch {
      ctx.response.status = 404;
      ctx.response.body = { success: false, error: "Not found" };
    }
  });

  app.use((ctx) => {
    ctx.response.status = 404;
    ctx.response.body = { success: false, error: "Not found" };
  });

  return app;
}

if (import.meta.main) {
  const PORT = parseInt(Deno.env.get("PORT") ?? "8091", 10);
  const HOST = Deno.env.get("HOST") ?? "127.0.0.1";
  const app = createApp();
  console.log(`Harrisbook API listening on http://${HOST}:${PORT}`);
  await app.listen({ hostname: HOST, port: PORT });
}
