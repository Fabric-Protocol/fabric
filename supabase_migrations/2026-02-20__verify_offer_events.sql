-- 2026-02-20: Verification checks for offer lifecycle eventing schema.

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where (table_schema = 'public' and table_name = 'nodes' and column_name = 'event_webhook_secret')
   or (table_schema = 'public' and table_name = 'offer_events' and column_name in ('id','offer_id','event_type','actor_node_id','recipient_node_id','payload','created_at'))
   or (table_schema = 'public' and table_name = 'event_webhook_deliveries' and column_name in ('id','event_id','node_id','webhook_url','attempt_number','next_retry_at','delivered_at','status_code','ok','error','created_at'))
order by table_name, ordinal_position;

select schemaname, tablename, indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'offer_events_recipient_created_idx',
    'offer_events_offer_created_idx',
    'event_webhook_deliveries_event_idx',
    'event_webhook_deliveries_node_created_idx',
    'event_webhook_deliveries_next_retry_idx'
  )
order by indexname;

select id, event_type, offer_id, actor_node_id, recipient_node_id, created_at
from public.offer_events
order by created_at desc
limit 10;

select id, event_id, node_id, attempt_number, ok, status_code, next_retry_at, delivered_at, created_at
from public.event_webhook_deliveries
order by created_at desc
limit 20;