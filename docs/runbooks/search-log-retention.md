# Search Log Retention Runbook (MVP)

## Policy
- Hot data in primary DB: 30 days.
- Archive window: up to 1 year (exported NDJSON file).
- Delete after 1 year.

## Command
- Dry run:
  - `npm run build && node dist/scripts/retention-search-logs.js --dry-run`
- Execute with default archive path:
  - `npm run retention:search-logs`
- Execute with explicit archive file:
  - `npm run build && node dist/scripts/retention-search-logs.js --archive-file ./var/search-logs-archive.ndjson`

## Operational notes
- Script writes JSON output summary including:
  - `archive_candidates`
  - `moved_out_of_hot_db_count`
  - `deleted_after_one_year_count`
- Archive files must be moved to access-controlled storage and retained for at most 1 year.
- Run daily (or more frequently) in operations automation.
