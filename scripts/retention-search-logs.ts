import fs from 'node:fs/promises';
import path from 'node:path';
import { query, pool } from '../src/db/client.js';
import { retentionCutoffs } from '../src/retentionPolicy.js';

type ArgMap = Record<string, string | boolean>;

type SearchLogArchiveRow = {
  id: string;
  node_id: string;
  kind: string;
  scope: string;
  query_redacted: string | null;
  query_hash: string | null;
  filters_json: unknown;
  page_count: number;
  broadening_level: number;
  credits_charged: number;
  created_at: string;
};

function parseArgs(argv: string[]): ArgMap {
  const args: ArgMap = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function utcDateTag(now: Date) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function toArchiveFilePath(value: string | boolean | undefined, now: Date) {
  if (typeof value === 'string' && value.trim()) return path.resolve(value.trim());
  return path.resolve('var', `search-logs-archive-${utcDateTag(now)}.ndjson`);
}

const args = parseArgs(process.argv.slice(2));
const now = new Date();
const { hotCutoff, deleteCutoff } = retentionCutoffs(now);
const dryRun = args['dry-run'] === true;
const archiveFilePath = toArchiveFilePath(args['archive-file'], now);

try {
  const rowsToArchive = await query<SearchLogArchiveRow>(
    `select id,node_id,kind,scope,query_redacted,query_hash,filters_json,page_count,broadening_level,credits_charged,created_at
     from search_logs
     where created_at < $1
       and created_at >= $2
     order by created_at asc`,
    [hotCutoff.toISOString(), deleteCutoff.toISOString()],
  );

  let archivedCount = 0;
  if (!dryRun && rowsToArchive.length > 0) {
    await fs.mkdir(path.dirname(archiveFilePath), { recursive: true });
    const lines = rowsToArchive.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await fs.appendFile(archiveFilePath, lines, 'utf8');
    archivedCount = rowsToArchive.length;
  }

  let movedOutOfHotDbCount = 0;
  if (!dryRun && rowsToArchive.length > 0) {
    const deleted = await query<{ id: string }>(
      `delete from search_logs
       where id = any($1::uuid[])
       returning id`,
      [rowsToArchive.map((row) => row.id)],
    );
    movedOutOfHotDbCount = deleted.length;
  }

  let deletedAfterOneYearCount = 0;
  if (!dryRun) {
    const deleted = await query<{ id: string }>(
      `delete from search_logs
       where created_at < $1
       returning id`,
      [deleteCutoff.toISOString()],
    );
    deletedAfterOneYearCount = deleted.length;
  }

  console.log(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    now: now.toISOString(),
    hot_cutoff: hotCutoff.toISOString(),
    delete_cutoff: deleteCutoff.toISOString(),
    archive_file: archiveFilePath,
    archive_candidates: rowsToArchive.length,
    archived_count: archivedCount,
    moved_out_of_hot_db_count: movedOutOfHotDbCount,
    deleted_after_one_year_count: deletedAfterOneYearCount,
  }));
} finally {
  await pool.end();
}
