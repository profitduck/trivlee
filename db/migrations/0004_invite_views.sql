-- Track when a user views a /join/[token] invite page without joining, so
-- they can come back to it from their dashboard. Auto-clears when they
-- actually join (or when the match closes — those rows are filtered out
-- in the dashboard query rather than deleted).

CREATE TABLE invite_views (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, challenge_id)
);

CREATE INDEX idx_invite_views_user ON invite_views(user_id, last_viewed_at DESC);
