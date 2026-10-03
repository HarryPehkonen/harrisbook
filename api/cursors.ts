/**
 * Harrisbook — server-side read cursors (per API token).
 *
 *   POST /api/read    — {boards:[...], upto_id:N} advance the CALLING token's cursor
 *   GET  /api/unread  — per-board {slug, last_id, new_count} for the calling token
 *
 * The cursor lives in `read_cursors(token_id, board_slug, last_id)` so it
 * survives host loss — the Pi lost its local watermark in the 2026-09-27
 * consolidation. It REPLACES per-host client state; it does not duplicate it.
 * Ordering is monotonic id, the same contract as `?after=` on the board poll;
 * `upto_id` never moves a cursor backwards (GREATEST), and one token can never
 * move another token's cursor. Cursors are keyed on api_tokens.id, so a GUI
 * session actor (no token) is rejected with 403.
 */

import { Router } from "jsr:@oak/oak";
import { queryObject } from "./db.ts";
import { requireActor } from "./auth.ts";

export const cursorsRouter = new Router();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// deno-lint-ignore no-explicit-any
function bad(ctx: any, error: string) {
  ctx.response.status = 400;
  ctx.response.body = { success: false, error };
}

// deno-lint-ignore no-explicit-any
function requirePat(ctx: any): number | null {
  const actor = ctx.state.actor;
  if (actor.kind !== "pat") {
    ctx.response.status = 403;
    ctx.response.body = {
      success: false,
      error: "read cursors are per token (PAT); a GUI session cannot use them",
    };
    return null;
  }
  return actor.tokenId as number;
}

// ---------------------------------------------------------------------------
// POST /api/read — advance this token's cursor on the named boards.
// ---------------------------------------------------------------------------

cursorsRouter.post("/api/read", requireActor, async (ctx) => {
  const tokenId = requirePat(ctx);
  if (tokenId === null) return;

  const body = await ctx.request.body.json().catch(() => null);
  const boards = body?.boards;
  const uptoId = Number(body?.upto_id);

  if (!Array.isArray(boards) || boards.length === 0) {
    return bad(ctx, "boards must be a non-empty array");
  }
  if (!boards.every((s) => typeof s === "string" && SLUG_RE.test(s))) {
    return bad(ctx, "each board must be a lowercase slug (a-z, 0-9, hyphen; max 64 chars)");
  }
  if (!Number.isInteger(uptoId) || uptoId < 0) {
    return bad(ctx, "upto_id must be a non-negative integer");
  }

  const updated: Record<string, unknown>[] = [];
  for (const slug of [...new Set<string>(boards)]) {
    // Auto-create the board (same rule as POST /api/posts) so the FK holds even
    // when a token reads a board that has no posts yet.
    await queryObject("INSERT INTO boards (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING", [
      slug,
    ]);
    const res = await queryObject(
      `INSERT INTO read_cursors (token_id, board_slug, last_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_id, board_slug) DO UPDATE
         SET last_id = GREATEST(read_cursors.last_id, EXCLUDED.last_id),
             updated_at = now()
       RETURNING board_slug AS slug, last_id::int AS last_id`,
      [tokenId, slug, uptoId],
    );
    updated.push(res.rows[0]);
  }
  ctx.response.body = { success: true, data: updated };
});

// ---------------------------------------------------------------------------
// GET /api/unread — per-board cursor + count of posts after it, for this token.
// ---------------------------------------------------------------------------

cursorsRouter.get("/api/unread", requireActor, async (ctx) => {
  const tokenId = requirePat(ctx);
  if (tokenId === null) return;

  const res = await queryObject(
    `SELECT b.slug,
            COALESCE(rc.last_id, 0)::int AS last_id,
            COUNT(p.id) FILTER (WHERE p.id > COALESCE(rc.last_id, 0))::int AS new_count
       FROM boards b
       LEFT JOIN read_cursors rc ON rc.board_slug = b.slug AND rc.token_id = $1
       LEFT JOIN posts p ON p.board_slug = b.slug
      GROUP BY b.slug, rc.last_id
      ORDER BY b.slug ASC`,
    [tokenId],
  );
  ctx.response.body = { success: true, data: res.rows };
});
