#!/usr/bin/env node
// One-off admin promotion script. Reads DATABASE_URL from the environment.
//
// Local dev:   npm run promote-admin alan
// Via Railway: railway run node scripts/promote-admin.mjs alan
//
// Accepts one or more usernames. Sets is_admin=true for each. Idempotent —
// running it twice doesn't break anything. Prints the before/after state.

import pg from "pg";

const usernames = process.argv.slice(2).filter((s) => s.length > 0);
if (usernames.length === 0) {
  console.error("usage: node scripts/promote-admin.mjs <username> [<username> ...]");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. For prod: `railway run node scripts/promote-admin.mjs <username>`");
  process.exit(1);
}

// Railway Postgres needs SSL; local brew Postgres doesn't. Match the migrate
// script's behavior: SSL on in production, off otherwise.
const ssl =
  process.env.NODE_ENV === "production" && process.env.PGSSL !== "false"
    ? { rejectUnauthorized: false }
    : undefined;

const client = new pg.Client({ connectionString, ssl });
await client.connect();

try {
  for (const username of usernames) {
    const { rows: before } = await client.query(
      `SELECT id, username, is_admin FROM users WHERE username = $1`,
      [username]
    );
    if (before.length === 0) {
      console.warn(`✗ ${username}: no such user`);
      continue;
    }
    const u = before[0];
    if (u.is_admin) {
      console.log(`= ${username}: already admin (id=${u.id})`);
      continue;
    }
    await client.query(`UPDATE users SET is_admin = true WHERE id = $1`, [u.id]);
    console.log(`✓ ${username}: promoted to admin (id=${u.id})`);
  }
} finally {
  await client.end();
}
