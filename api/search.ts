/**
 * Harrisbook — search route.
 *
 *   GET /api/search?q=<text>&board=<slug?>
 *
 * Full-text search over the generated `posts.search` tsvector using
 * plainto_tsquery('english', q). Optional board filter. Newest-first, limit 50.
 * Empty/missing q -> 400.
 */

import { Router } from "jsr:@oak/oak";
import { queryObject } from "./db.ts";
import { requireActor } from "./auth.ts";

export const searchRouter = new Router();

const LIMIT = 50;

searchRouter.get("/api/search", requireActor, async (ctx) => {
  const params = ctx.request.url.searchParams;
  const q = (params.get("q") ?? "").trim();
  const board = params.get("board");

  if (!q) {
    ctx.response.status = 400;
    ctx.response.body = { success: false, error: "q is required" };
    return;
  }

  const values: unknown[] = [q];
  let boardClause = "";
  if (board) {
    values.push(board);
    boardClause = `AND board_slug = $${values.length}`;
  }
  values.push(LIMIT);

  const res = await queryObject(
    `SELECT id::int AS id, board_slug, originator, subject, body, mentions, created_at, updated_at
       FROM posts
      WHERE search @@ plainto_tsquery('english', $1)
        ${boardClause}
      ORDER BY id DESC
      LIMIT $${values.length}`,
    values,
  );

  ctx.response.body = { success: true, data: res.rows };
});
