/**
 * Harrisbook — posts & boards routes.
 *
 *   POST /api/posts   — create a post (fan-out, auto-creates boards)
 */

import { Router } from "jsr:@oak/oak";
import { getClient } from "./db.ts";
import { requireActor } from "./auth.ts";

export const postsRouter = new Router();

// id is BIGINT — cast to int for JSON (BigInt is not serializable; TNGPlaylists gotcha #1).
const POST_COLS =
  "id::int AS id, board_slug, originator, subject, body, created_at, updated_at";

// ---------------------------------------------------------------------------
// POST /api/posts
// ---------------------------------------------------------------------------

postsRouter.post("/api/posts", requireActor, async (ctx) => {
  const body = await ctx.request.body.json().catch(() => null);
  const boards: string[] = body?.boards;
  const subject: string = body?.subject;
  const postBody: string = body?.body ?? "";

  const originator = ctx.state.actor.name;
  const client = await getClient();
  const created: Record<string, unknown>[] = [];
  const tx = client.createTransaction("post_fanout");
  await tx.begin();
  try {
    for (const slug of boards) {
      await tx.queryArray(
        "INSERT INTO boards (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING",
        [slug],
      );
      const res = await tx.queryObject<Record<string, unknown>>(
        `INSERT INTO posts (board_slug, originator, subject, body)
         VALUES ($1, $2, $3, $4)
         RETURNING ${POST_COLS}`,
        [slug, originator, subject, postBody],
      );
      created.push(res.rows[0]);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  ctx.response.body = { success: true, data: created };
});
