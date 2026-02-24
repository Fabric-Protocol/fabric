-- 2026-02-24: Verification checks for request expiry schema.

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'requests'
  and column_name = 'expires_at';

select schemaname, tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'requests'
  and indexname = 'requests_expires_idx';
