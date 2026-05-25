-- N-player match support: add caps, auto-close, and a participants table.
-- Existing 1v1 challenges remain valid; their challenger + opponent get backfilled
-- into challenge_participants. The legacy `opponent_id` column stays for now
-- (deprecated; not read by new code) so we don't break old rows during transition.

ALTER TABLE challenges
  ADD COLUMN max_players       INTEGER CHECK (max_players IS NULL OR max_players BETWEEN 2 AND 100),
  ADD COLUMN auto_close_at     TIMESTAMPTZ,
  ADD COLUMN closed_at         TIMESTAMPTZ;

-- max_players: NULL = open (no cap), otherwise the join limit.
-- auto_close_at: when set, any page-load past this time lazily closes the match.
-- closed_at: when set, no further joins or play; results are locked.

CREATE TABLE challenge_participants (
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_challenger BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (challenge_id, user_id)
);

CREATE INDEX idx_challenge_participants_user ON challenge_participants(user_id, joined_at DESC);
CREATE INDEX idx_challenge_participants_challenge ON challenge_participants(challenge_id, joined_at);

-- Backfill: every existing challenger becomes a participant with is_challenger=true.
INSERT INTO challenge_participants (challenge_id, user_id, joined_at, is_challenger)
SELECT id, challenger_id, created_at, true
FROM challenges
WHERE challenger_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill: every existing opponent becomes a participant (is_challenger=false).
INSERT INTO challenge_participants (challenge_id, user_id, joined_at, is_challenger)
SELECT id, opponent_id, created_at, false
FROM challenges
WHERE opponent_id IS NOT NULL
ON CONFLICT DO NOTHING;
