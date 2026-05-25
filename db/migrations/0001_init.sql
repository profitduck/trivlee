CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- Users
-- =============================================================
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     CITEXT NOT NULL UNIQUE,
  email        CITEXT UNIQUE,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_]{3,20}$')
);

-- =============================================================
-- Friendships (directional row: requester -> target)
-- =============================================================
CREATE TYPE friendship_status AS ENUM ('pending', 'accepted', 'blocked');

CREATE TABLE friendships (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     friendship_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE INDEX idx_friendships_friend ON friendships(friend_id, status);

-- =============================================================
-- Invite links (single-use tokens for adding friends)
-- =============================================================
CREATE TABLE invite_links (
  token       TEXT PRIMARY KEY,
  inviter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- Challenges (a match between two players)
-- =============================================================
CREATE TYPE challenge_format AS ENUM ('multiple_choice', 'free_text', 'mixed');
CREATE TYPE challenge_mode AS ENUM ('async', 'live');
CREATE TYPE challenge_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

CREATE TABLE challenges (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id          UUID REFERENCES users(id) ON DELETE CASCADE,   -- NULL for "open" invite via link
  topic                TEXT NOT NULL,
  topic_normalized     TEXT NOT NULL,
  topic_interpretation TEXT,                                         -- echoed back by the model
  knowledge_warning    TEXT,                                         -- non-null if model capped difficulty
  difficulty_requested INTEGER NOT NULL CHECK (difficulty_requested BETWEEN 1 AND 10),
  difficulty_delivered INTEGER CHECK (difficulty_delivered BETWEEN 1 AND 10),
  num_questions        INTEGER NOT NULL CHECK (num_questions BETWEEN 1 AND 50),
  format               challenge_format NOT NULL,
  mode                 challenge_mode NOT NULL,
  time_per_question_s  INTEGER,                                      -- NULL = untimed per question
  total_time_s         INTEGER,                                      -- NULL = no total cap
  status               challenge_status NOT NULL DEFAULT 'pending',
  invite_token         TEXT UNIQUE,                                  -- shareable link
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ
);

CREATE INDEX idx_challenges_challenger ON challenges(challenger_id, status, created_at DESC);
CREATE INDEX idx_challenges_opponent ON challenges(opponent_id, status, created_at DESC);
CREATE INDEX idx_challenges_invite ON challenges(invite_token) WHERE invite_token IS NOT NULL;

-- =============================================================
-- Question sets (the AI-generated batch for a challenge)
-- =============================================================
CREATE TABLE question_sets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id     UUID NOT NULL UNIQUE REFERENCES challenges(id) ON DELETE CASCADE,
  topic_normalized TEXT NOT NULL,
  difficulty       INTEGER NOT NULL,
  format           challenge_format NOT NULL,
  generated_by     TEXT NOT NULL,                -- 'mock' | 'claude-sonnet-4-6' | 'user'
  generation_meta  JSONB NOT NULL DEFAULT '{}',  -- model latency, tokens, etc.
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- Questions (individual items in a set)
-- =============================================================
CREATE TYPE question_type AS ENUM ('factual', 'quote', 'identification', 'numeric');
CREATE TYPE per_question_format AS ENUM ('multiple_choice', 'free_text');

CREATE TABLE questions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id              UUID NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  question_text       TEXT NOT NULL,
  correct_answer      TEXT NOT NULL,
  answer_aliases      JSONB NOT NULL DEFAULT '[]',
  distractors         JSONB NOT NULL DEFAULT '[]',
  source_hint         TEXT,
  type                question_type NOT NULL DEFAULT 'factual',
  per_question_format per_question_format NOT NULL,
  author_id           UUID REFERENCES users(id) ON DELETE SET NULL, -- non-null only for user-submitted
  bank_question_id    UUID,                                          -- backref to bank if drawn from cache
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (set_id, position)
);

CREATE INDEX idx_questions_set ON questions(set_id, position);

-- =============================================================
-- Attempts (one row per question per player)
-- =============================================================
CREATE TABLE attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  question_id   UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_answer   TEXT,                                  -- NULL if skipped/timed out
  is_correct    BOOLEAN,                               -- NULL until graded
  score         NUMERIC(4, 3) NOT NULL DEFAULT 0,      -- 0.000 to 1.000 (partial credit possible)
  grade_method  TEXT,                                  -- 'exact' | 'fuzzy' | 'llm-judge' | 'mc'
  grade_reason  TEXT,                                  -- only for llm-judge tier
  time_taken_ms INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, question_id, user_id)
);

CREATE INDEX idx_attempts_challenge_user ON attempts(challenge_id, user_id);

-- =============================================================
-- Results (per-player totals at match completion)
-- =============================================================
CREATE TABLE results (
  challenge_id  UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_score   NUMERIC(6, 3) NOT NULL,
  correct_count INTEGER NOT NULL,
  total_time_ms INTEGER,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);

-- =============================================================
-- Question reports (players flag bad questions)
-- =============================================================
CREATE TYPE report_status AS ENUM ('open', 'reviewed_kept', 'reviewed_removed');

CREATE TABLE question_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  status      report_status NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, reporter_id)
);

CREATE INDEX idx_question_reports_open ON question_reports(status, created_at DESC);

-- =============================================================
-- Question ratings (post-game quality + perceived difficulty)
-- =============================================================
CREATE TABLE question_ratings (
  question_id        UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quality_rating     INTEGER CHECK (quality_rating BETWEEN 1 AND 5),
  difficulty_rating  INTEGER CHECK (difficulty_rating BETWEEN 1 AND 10),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);

-- =============================================================
-- Question bank (curated cache feeding future generations)
-- =============================================================
CREATE TABLE question_bank (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_normalized    TEXT NOT NULL,
  difficulty          INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 10),
  per_question_format per_question_format NOT NULL,
  question_text       TEXT NOT NULL,
  correct_answer      TEXT NOT NULL,
  answer_aliases      JSONB NOT NULL DEFAULT '[]',
  distractors         JSONB NOT NULL DEFAULT '[]',
  source_hint         TEXT,
  type                question_type NOT NULL DEFAULT 'factual',
  quality_score       NUMERIC(3, 2) NOT NULL DEFAULT 0,   -- aggregated from ratings, 0..5
  rating_count        INTEGER NOT NULL DEFAULT 0,
  report_count        INTEGER NOT NULL DEFAULT 0,
  times_used          INTEGER NOT NULL DEFAULT 0,
  hidden              BOOLEAN NOT NULL DEFAULT false,
  source_question_id  UUID REFERENCES questions(id) ON DELETE SET NULL,
  author_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (topic_normalized, difficulty, question_text)
);

CREATE INDEX idx_bank_lookup ON question_bank(topic_normalized, difficulty, per_question_format)
  WHERE hidden = false;
