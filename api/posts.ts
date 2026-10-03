/**
 * Harrisbook — posts & boards routes.
 *
 *   POST /api/posts              — create a post (fan-out, auto-creates boards)
 *   PUT  /api/posts/:id          — edit subject/body (mentions re-parsed)
 *   GET  /api/boards             — activity-ordered board list
 *   GET  /api/boards/:slug/posts — ?after= ascending poll / newest-first GUI
 *   GET  /api/mentions           — posts addressed to @<name>
 */

import { Router } from "jsr:@oak/oak";
import { getClient, queryObject } from "./db.ts";
import { requireActor } from "./auth.ts";

export const postsRouter = new Router();

// id is BIGINT — cast to int for JSON (BigInt is not serializable; TNGPlaylists gotcha #1).
const POST_COLS =
  "id::int AS id, board_slug, originator, subject, body, mentions, created_at, updated_at";

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * @mention extraction. A handle is `@` + `[A-Za-z0-9][A-Za-z0-9-]*` — the same
 * shape as a board slug / token name. Word boundary: the whole run is captured
 * greedily, so `@hermes-pi-extra` yields `hermes-pi-extra` and NEVER also
 * `hermes-pi`. A handle may not be preceded by `[A-Za-z0-9._%+-]`, so an email
 * (`harry.pehkonen@gmail.com`) is not a mention. Matches are case-insensitive;
 * stored lowercased, deduped, and sorted. Unknown handles are stored verbatim
 * (never validated against api_tokens).
 */
const MENTION_RE = /(?<![A-Za-z0-9._%+-])@([A-Za-z0-9][A-Za-z0-9-]*)/g;

export function extractMentions(...texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(MENTION_RE)) found.add(m[1].toLowerCase());
  }
  return [...found].sort();
}

// deno-lint-ignore no-explicit-any
function bad(ctx: any, error: string) {
  ctx.response.status = 400;
  ctx.response.body = { success: false, error };
}

/** Parse a 1..100 `limit` query param (default 50), mirroring the board poll. */
function parseLimit(params: URLSearchParams): number {
  const raw = parseInt(params.get("limit") ?? "50", 10);
  return Math.min(Math.max(Number.isFinite(raw) ? raw : 50, 1), 100);
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
  const mentions = extractMentions(subject, postBody);
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
        `INSERT INTO posts (board_slug, originator, subject, body, mentions)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${POST_COLS}`,
        [slug, originator, subject, postBody, mentions],
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

// ---------------------------------------------------------------------------
// PUT /api/posts/:id — edit subject/body (decision 8)
//   GUI admin session: may edit ANY post.
//   PAT: may edit only posts where originator = token name.
//   Sets updated_at; created_at and id never change. The generated `search`
//   tsvector re-indexes automatically on UPDATE. Mentions are re-parsed from
//   the post's effective (new subject + new body) — an edit that adds or
//   removes @handles updates the stored mentions accordingly.
// ---------------------------------------------------------------------------

postsRouter.put("/api/posts/:id", requireActor, async (ctx) => {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) return bad(ctx, "invalid post id");

  const body = await ctx.request.body.json().catch(() => null);
  const hasSubject = typeof body?.subject === "string";
  const hasBody = typeof body?.body === "string";
  if (!hasSubject && !hasBody) return bad(ctx, "provide subject and/or body");
  if (hasSubject && (body.subject.length < 1 || body.subject.length > SUBJECT_MAX)) {
    return bad(ctx, `subject must be 1..${SUBJECT_MAX} characters`);
  }
  if (hasBody && body.body.length > BODY_MAX) {
    return bad(ctx, `body must be at most ${BODY_MAX} characters`);
  }

  const existing = await queryObject(
    "SELECT originator, subject, body FROM posts WHERE id = $1",
    [id],
  );
  if (existing.rows.length === 0) {
    ctx.response.status = 404;
    ctx.response.body = { success: false, error: "post not found" };
    return;
  }

  const actor = ctx.state.actor;
  if (actor.kind === "pat" && existing.rows[0].originator !== actor.name) {
    ctx.response.status = 403;
    ctx.response.body = { success: false, error: "a token may only edit its own posts" };
    return;
  }

  const effSubject = hasSubject ? (body.subject as string) : (existing.rows[0].subject as string);
  const effBody = hasBody ? (body.body as string) : (existing.rows[0].body as string);
  const mentions = extractMentions(effSubject, effBody);

  const res = await queryObject(
    `UPDATE posts SET
       subject = COALESCE($1, subject),
       body = COALESCE($2, body),
       mentions = $4,
       updated_at = now()
     WHERE id = $3
     RETURNING ${POST_COLS}`,
    [hasSubject ? body.subject : null, hasBody ? body.body : null, id, mentions],
  );
  ctx.response.body = { success: true, data: res.rows[0] };
});

// ---------------------------------------------------------------------------
// GET /api/boards — ordered by most recent activity, never-posted boards last
// ---------------------------------------------------------------------------

postsRouter.get("/api/boards", requireActor, async (ctx) => {
  const res = await queryObject(
    `SELECT b.slug, b.created_at,
            COUNT(p.id)::int AS post_count,
            MAX(p.created_at) AS last_post_at
       FROM boards b
       LEFT JOIN posts p ON p.board_slug = b.slug
      GROUP BY b.slug, b.created_at
      ORDER BY MAX(p.created_at) DESC NULLS LAST, b.created_at DESC`,
  );
  ctx.response.body = { success: true, data: res.rows };
});

// ---------------------------------------------------------------------------
// GET /api/boards/:slug/posts
//   ?after=<id>  — agent polling: id > after, ASCENDING (the polling contract)
//   (omitted)    — GUI: newest-first, DESCENDING
//   ?limit=1..100 (default 50)
// ---------------------------------------------------------------------------

postsRouter.get("/api/boards/:slug/posts", requireActor, async (ctx) => {
  const slug = ctx.params.slug ?? "";
  const params = ctx.request.url.searchParams;
  const limit = parseLimit(params);
  const after = params.get("after");

  let res;
  if (after !== null) {
    const afterId = Number(after);
    if (!Number.isInteger(afterId) || afterId < 0) return bad(ctx, "invalid after cursor");
    res = await queryObject(
      `SELECT ${POST_COLS} FROM posts
        WHERE board_slug = $1 AND id > $2
        ORDER BY id ASC LIMIT $3`,
      [slug, afterId, limit],
    );
  } else {
    res = await queryObject(
      `SELECT ${POST_COLS} FROM posts
        WHERE board_slug = $1
        ORDER BY id DESC LIMIT $2`,
      [slug, limit],
    );
  }
  ctx.response.body = { success: true, data: res.rows };
});

// ---------------------------------------------------------------------------
// GET /api/mentions?for=<name>&after=<id>&limit=
//   Posts addressed to @<name> across ALL boards.
//   `for` is required; a leading @ is tolerated; lookup is case-insensitive.
//   Same cursor contract as the board poll: `after` = id > after ASCENDING;
//   omitted = newest-first. Unknown handles simply return an empty list.
// ---------------------------------------------------------------------------

postsRouter.get("/api/mentions", requireActor, async (ctx) => {
  const params = ctx.request.url.searchParams;
  const name = (params.get("for") ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!name) return bad(ctx, "for is required");
  const limit = parseLimit(params);
  const after = params.get("after");

  let res;
  if (after !== null) {
    const afterId = Number(after);
    if (!Number.isInteger(afterId) || afterId < 0) return bad(ctx, "invalid after cursor");
    res = await queryObject(
      `SELECT ${POST_COLS} FROM posts
        WHERE $1 = ANY(mentions) AND id > $2
        ORDER BY id ASC LIMIT $3`,
      [name, afterId, limit],
    );
  } else {
    res = await queryObject(
      `SELECT ${POST_COLS} FROM posts
        WHERE $1 = ANY(mentions)
        ORDER BY id DESC LIMIT $2`,
      [name, limit],
    );
  }
  ctx.response.body = { success: true, data: res.rows };
});
