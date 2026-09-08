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

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// deno-lint-ignore no-explicit-any
function bad(ctx: any, error: string) {
  ctx.response.status = 400;
  ctx.response.body = { success: false, error };
}

// ---------------------------------------------------------------------------
// POST /api/posts
// ---------------------------------------------------------------------------

postsRouter.post("/api/posts", requireActor, async (ctx) => {
  const body = await ctx.request.body.json().catch(() => null);
  const boards = body?.boards;
  const subject = body?.subject;
  const postBody = body?.body ?? "";

  if (!Array.isArray(boards) || boards.length === 0) {
    return bad(ctx, "boards must be a non-empty array");
  }
  if (!boards.every((s) => typeof s === "string" && SLUG_RE.test(s))) {
    return bad(ctx, "each board must be a lowercase slug (a-z, 0-9, hyphen; max 64 chars)");
  }
  if (typeof subject !== "string" || subject.length < 1 || subject.length > SUBJECT_MAX) {
    return bad(ctx, `subject must be 1..${SUBJECT_MAX} characters`);
  }
  if (typeof postBody !== "string" || postBody.length > BODY_MAX) {
    return bad(ctx, `body must be at most ${BODY_MAX} characters`);
  }

  const uniqueBoards = [...new Set<string>(boards)];
  const originator = ctx.state.actor.name;
  const client = await getClient();
  const created: Record<string, unknown>[] = [];
  const tx = client.createTransaction("post_fanout");
  await tx.begin();
  try {
    for (const slug of uniqueBoards) {
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
