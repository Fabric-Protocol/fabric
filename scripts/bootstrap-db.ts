import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db/client.js';

const ddlPath = path.resolve('docs/specs/21__db-ddl.sql');
const raw = await fs.readFile(ddlPath, 'utf8');
const sql = raw
  .replace(/```sql/g, '')
  .replace(/```/g, '')
  .split('\n')
  .filter((line) => !line.startsWith('## `'))
  .join('\n');

await pool.query(sql);
await pool.end();
console.log('DB bootstrap complete');
