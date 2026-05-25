import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Locally: did you forget .env.local? In production: did you forget to link the Postgres service?"
  );
  process.exit(1);
}

// Managed Postgres (Railway, Neon, etc.) requires SSL but with a self-signed
// cert chain. Local brew Postgres doesn't use SSL. Toggle based on NODE_ENV.
const ssl =
  process.env.NODE_ENV === "production" && process.env.PGSSL !== "false"
    ? { rejectUnauthorized: false }
    : undefined;

const client = new pg.Client({ connectionString, ssl });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name)
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`→ applying ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      appliedCount++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  ✗ ${file} failed`);
      throw err;
    }
  }

  if (appliedCount === 0) {
    console.log("Schema is up to date.");
  } else {
    console.log(`Applied ${appliedCount} migration(s).`);
  }
} finally {
  await client.end();
}
