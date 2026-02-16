import { config } from './config.js';

type ParsedHost = string | 'unparseable' | null;

export function parseDatabaseUrlHost(databaseUrl: string | null | undefined): ParsedHost {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).host || null;
  } catch {
    return 'unparseable';
  }
}

export function getSafeDbEnvDiagnostics() {
  const envDatabaseUrl = process.env.DATABASE_URL;
  const pghost = process.env.PGHOST ?? null;
  const pgport = process.env.PGPORT ?? null;

  return {
    database_url_present: Boolean(envDatabaseUrl),
    database_url_host: parseDatabaseUrlHost(envDatabaseUrl),
    pghost_present: Boolean(pghost),
    pghost,
    pgport,
    database_ssl_ca_present: Boolean(config.databaseSslCa),
    config_database_url_present: Boolean(config.databaseUrl),
    config_database_url_host: parseDatabaseUrlHost(config.databaseUrl),
  };
}
