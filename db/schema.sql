-- Harrisbook — core schema (boards, posts + FTS, api_tokens)
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- set by PUT /api/posts/:id
  search     tsvector GENERATED ALWAYS AS (to_tsvector('english', subject || ' ' || body)) STORED
);

CREATE INDEX IF NOT EXISTS posts_board_id_idx ON posts(board_slug, id DESC);
CREATE INDEX IF NOT EXISTS posts_originator_idx ON posts(originator);
CREATE INDEX IF NOT EXISTS posts_search_gin ON posts USING GIN(search);

CREATE TABLE IF NOT EXISTS api_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,          -- e.g. 'hermes-dinner', 'harri-cli'
  token_hash TEXT NOT NULL,                 -- sha256 hex of the raw token
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
