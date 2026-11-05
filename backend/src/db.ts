import pg from 'pg';

export type Db = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string, max = 10): Db {
  return new pg.Pool({ connectionString, max, application_name: 'usports-api' });
}

/** Run `fn` in a transaction on one client; rolls back on any thrown error. */
export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
