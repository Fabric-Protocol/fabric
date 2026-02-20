-- 2026-02-20: Verification checks for messaging handle schema.

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where (table_schema = 'public' and table_name = 'nodes' and column_name = 'messaging_handles')
   or (table_schema = 'public' and table_name = 'contact_reveals' and column_name = 'revealed_messaging_handles')
order by table_name, column_name;

select count(*) as nodes_with_null_messaging_handles
from public.nodes
where messaging_handles is null;

select id, messaging_handles
from public.nodes
order by created_at desc
limit 5;

select id, offer_id, revealed_messaging_handles
from public.contact_reveals
order by created_at desc
limit 5;