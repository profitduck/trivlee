-- Admin gate for the moderation queue. Seed Alice as admin so dev testing
-- against the quick-switch user has access.

ALTER TABLE users
  ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE users SET is_admin = true WHERE username = 'alice';
