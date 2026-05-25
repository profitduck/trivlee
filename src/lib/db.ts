import "server-only";
import pg from "pg";

const globalForPg = globalThis as unknown as { __pgPool?: pg.Pool };

export const pool: pg.Pool =
  globalForPg.__pgPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
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
