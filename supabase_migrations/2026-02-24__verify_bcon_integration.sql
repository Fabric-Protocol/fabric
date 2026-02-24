-- 2026-02-24: Verification checks for Bcon integration schema.

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('bcon_invoices', 'bcon_txns')
order by table_name, ordinal_position;

select schemaname, tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename in ('bcon_invoices', 'bcon_txns')
order by tablename, indexname;
