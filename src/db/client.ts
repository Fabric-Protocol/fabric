import { Pool } from 'pg';
import { config } from '../config.js';
import { getSafeDbEnvDiagnostics, parseDatabaseUrlHost } from '../dbEnvDiagnostics.js';

const connectionString = config.databaseUrl || undefined;
console.log(JSON.stringify({
  msg: 'pg pool config',
  pool_connection_string_present: Boolean(connectionString),
  pool_connection_string_undefined: connectionString === undefined,
  pool_connection_string_host: parseDatabaseUrlHost(connectionString),
  ...getSafeDbEnvDiagnostics(),
}));

export const pool = new Pool({ connectionString });

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
