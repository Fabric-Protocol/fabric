import { Pool } from 'pg';
import { config } from '../config.js';
import { getSafeDbEnvDiagnostics, parseDatabaseUrlHost } from '../dbEnvDiagnostics.js';

function sanitizeDatabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) return undefined;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('sslrootcert');
    parsed.searchParams.delete('sslcert');
    parsed.searchParams.delete('sslkey');
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function isLocalDatabaseHost(rawUrl: string | undefined) {
  if (!rawUrl) return false;
  try {
    const hostname = new URL(rawUrl).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

const connectionString = sanitizeDatabaseUrl(config.databaseUrl || undefined);
const ssl = isLocalDatabaseHost(connectionString)
  ? undefined
  : config.databaseSslCa
    ? { ca: config.databaseSslCa, rejectUnauthorized: true }
    : { rejectUnauthorized: true };

console.log(JSON.stringify({
  msg: 'pg pool config',
  pool_connection_string_present: Boolean(connectionString),
  pool_connection_string_undefined: connectionString === undefined,
  pool_connection_string_host: parseDatabaseUrlHost(connectionString),
  database_ssl_ca_present: Boolean(config.databaseSslCa),
  ...getSafeDbEnvDiagnostics(),
}));

export const pool = new Pool({ connectionString, ssl });

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
