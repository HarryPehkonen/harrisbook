-- Harrisbook — GUI auth schema (Google OAuth sessions).
-- Copied from TNGPlaylists. Apply AS the app DB owner (hb_user), never as the
-- postgres superuser. Idempotent (IF NOT EXISTS everywhere).
--
-- v1: sign-in is allowed ONLY for emails in ADMIN_EMAILS (403 otherwise). Every
-- admitted user keeps role 'admin'.

CREATE TABLE IF NOT EXISTS users (
  user_id      SERIAL PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  display_name TEXT,
  picture      TEXT,
  role         TEXT NOT NULL DEFAULT 'admin'
               CHECK (role IN ('admin')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_providers (
  user_id      INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,              -- 'google' (extensible)
  provider_sub TEXT NOT NULL,              -- provider's stable user id
  PRIMARY KEY (provider, provider_sub)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,             -- sha256 hex of the random session token
  user_id    INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
