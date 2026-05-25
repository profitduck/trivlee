import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query(`
    INSERT INTO users (id, username, email, display_name)
    VALUES
      ('11111111-1111-1111-1111-111111111111', 'alice',  'alice@example.com',  'Alice'),
      ('22222222-2222-2222-2222-222222222222', 'bob',    'bob@example.com',    'Bob'),
      ('33333333-3333-3333-3333-333333333333', 'charlie','charlie@example.com','Charlie')
    ON CONFLICT (id) DO NOTHING
  `);

  await client.query(`
    INSERT INTO friendships (user_id, friend_id, status)
    VALUES
      ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'accepted'),
      ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'pending')
    ON CONFLICT DO NOTHING
  `);

  const { rows } = await client.query("SELECT username FROM users ORDER BY username");
  console.log("Seeded users:", rows.map((r) => r.username).join(", "));
} finally {
  await client.end();
}
