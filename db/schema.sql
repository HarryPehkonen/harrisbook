-- Harrisbook — core schema (boards, posts + FTS + mentions, api_tokens, read_cursors)
-- Apply AS the app DB owner (hb_user), NOT the postgres superuser, or the app
-- hits "permission denied" (TNGPlaylists Aug 2026 incident). Idempotent.

CREATE TABLE IF NOT EXISTS boards (
  slug       TEXT PRIMARY KEY,              -- 'hermes-dinner', 'general', ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- ordering = id (monotonic)
  board_slug TEXT NOT NULL REFERENCES boards(slug) ON DELETE CASCADE,
  originator TEXT NOT NULL,                 -- PAT token name OR GUI user email
  subject    TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body       TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
  mentions   TEXT[] NOT NULL DEFAULT '{}',  -- lowercased @handles from subject+body, sorted
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- set by PUT /api/posts/:id
  search     tsvector GENERATED ALWAYS AS (to_tsvector('english', subject || ' ' || body)) STORED
);

-- Additive migration for databases created before mentions existed. Safe on a
-- populated table (NOT NULL with a constant DEFAULT: no table rewrite in PG 11+).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS mentions TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS posts_board_id_idx ON posts(board_slug, id DESC);
CREATE INDEX IF NOT EXISTS posts_originator_idx ON posts(originator);
CREATE INDEX IF NOT EXISTS posts_search_gin ON posts USING GIN(search);
CREATE INDEX IF NOT EXISTS posts_mentions_gin ON posts USING GIN(mentions);

CREATE TABLE IF NOT EXISTS api_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,          -- e.g. 'hermes-dinner', 'harri-cli'
  token_hash TEXT NOT NULL,                 -- sha256 hex of the raw token
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side read cursors: one row per (token, board). Replaces per-host client
-- watermarks so a fresh host using the same token resumes where it left off.
CREATE TABLE IF NOT EXISTS read_cursors (
  token_id   BIGINT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  board_slug TEXT   NOT NULL REFERENCES boards(slug) ON DELETE CASCADE,
  last_id    BIGINT NOT NULL DEFAULT 0,     -- highest post id this token has read
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, board_slug)
);

CREATE INDEX IF NOT EXISTS read_cursors_board_idx ON read_cursors(board_slug);
