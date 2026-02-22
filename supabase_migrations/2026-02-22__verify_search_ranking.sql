-- 2026-02-22: Verification checks for search ranking schema.

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where (table_schema = 'public' and table_name = 'units' and column_name = 'max_ship_days')
   or (table_schema = 'public' and table_name = 'requests' and column_name = 'max_ship_days')
   or (table_schema = 'public' and table_name = 'public_listings' and column_name in ('doc', 'search_tsv', 'updated_at'))
   or (table_schema = 'public' and table_name = 'public_requests' and column_name in ('doc', 'search_tsv', 'updated_at'))
order by table_name, ordinal_position;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'public_listings_search_tsv_gin',
    'public_requests_search_tsv_gin'
  )
order by indexname;

select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  p.proname as function_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and n.nspname = 'public'
  and t.tgname in (
    'public_listings_set_search_tsv',
    'public_requests_set_search_tsv'
  )
order by trigger_name;

select
  n.nspname as schema_name,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'fn_public_doc_to_tsv',
    'fn_set_public_projection_search_tsv'
  )
order by p.proname;

select
  p.unit_id,
  ts_rank_cd(p.search_tsv, websearch_to_tsquery('english', 'test')) as fts_rank
from public.public_listings p
where p.search_tsv @@ websearch_to_tsquery('english', 'test')
order by fts_rank desc, p.updated_at desc
limit 5;

select
  p.request_id,
  ts_rank_cd(p.search_tsv, websearch_to_tsquery('english', 'test')) as fts_rank
from public.public_requests p
where p.search_tsv @@ websearch_to_tsquery('english', 'test')
order by fts_rank desc, p.updated_at desc
limit 5;