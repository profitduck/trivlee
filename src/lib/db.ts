import "server-only";
import pg from "pg";

const globalForPg = globalThis as unknown as { __pgPool?: pg.Pool };

// Railway / Neon / most managed Postgres providers require SSL with a
// self-signed cert chain. Enable SSL in production but skip strict CA
// verification (Railway's chain isn't in Node's default trust store).
// Local Postgres (brew) doesn't use SSL, so leave it off there.
function buildSslConfig(): pg.PoolConfig["ssl"] {
  if (process.env.NODE_ENV !== "production") return undefined;
  if (process.env.PGSSL === "false") return undefined;
  return { rejectUnauthorized: false };
}

export const pool: pg.Pool =
  globalForPg.__pgPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    ssl: buildSslConfig(),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.__pgPool = pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never);
}
