BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
  id text PRIMARY KEY, clerk_user_id text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  avatar_url text, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE rooms (
  id text PRIMARY KEY, code text NOT NULL UNIQUE, host_user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL, visibility text NOT NULL CHECK (visibility IN ('private','public')),
  status text NOT NULL, settings_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE room_members (
  room_id text NOT NULL REFERENCES rooms(id), user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('host','participant','spectator')), team_id text,
  joined_at timestamptz NOT NULL DEFAULT now(), banned boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_id,user_id)
);
CREATE INDEX room_members_user ON room_members(user_id);
CREATE TABLE room_index (
  room_id text PRIMARY KEY REFERENCES rooms(id), code text NOT NULL UNIQUE,
  host_user_id text NOT NULL REFERENCES users(id), name text NOT NULL, status text NOT NULL,
  member_count integer NOT NULL DEFAULT 0, last_version bigint NOT NULL DEFAULT 0,
  last_event_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE players (
  id text PRIMARY KEY, name text NOT NULL, country text NOT NULL, role text NOT NULL,
  base_price integer NOT NULL CHECK (base_price > 0), batting_style text, bowling_style text,
  stats_json jsonb, overseas boolean NOT NULL, image_url text,
  is_sample boolean NOT NULL DEFAULT true, licensed_source text, seed_version integer NOT NULL,
  CHECK (is_sample OR licensed_source IS NOT NULL)
);
CREATE TABLE player_pools (id text PRIMARY KEY, name text NOT NULL, version integer NOT NULL);
CREATE TABLE player_pool_items (pool_id text REFERENCES player_pools(id), player_id text REFERENCES players(id), position integer NOT NULL, PRIMARY KEY(pool_id, player_id), UNIQUE(pool_id,position));
CREATE TABLE auction_results (
  room_id text PRIMARY KEY REFERENCES rooms(id), completion_version bigint NOT NULL,
  summary_json jsonb NOT NULL, history_json jsonb NOT NULL, rule_violations jsonb NOT NULL DEFAULT '[]',
  completed_at timestamptz NOT NULL
);
CREATE TABLE invite_tokens (
  id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id), token_hash text NOT NULL UNIQUE,
  created_by text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK(max_uses > 0), uses integer NOT NULL DEFAULT 0 CHECK(uses >= 0), revoked_at timestamptz,
  CHECK(uses <= max_uses)
);
CREATE TABLE share_tokens (
  id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id), token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE reports (
  id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id), reporter_id text NOT NULL REFERENCES users(id),
  subject_id text NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (1);
COMMIT;
