import { Pool } from 'pg';
import { config } from '../config.js';

export const pool = new Pool({ connectionString: config.databaseUrl || undefined });

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
