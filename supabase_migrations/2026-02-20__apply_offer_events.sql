-- 2026-02-20: Offer lifecycle eventing schema alignment
-- Adds webhook signing secret and delivery retry audit columns.
-- Safe to re-run.

begin;

alter table public.nodes
  add column if not exists event_webhook_secret text null;

create table if not exists public.offer_events (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  event_type text not null check (event_type in (
    'offer_created',
    'offer_countered',
    'offer_accepted',
    'offer_cancelled',
    'offer_contact_revealed'
  )),
  actor_node_id uuid not null references public.nodes(id),
  recipient_node_id uuid not null references public.nodes(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists offer_events_recipient_created_idx
  on public.offer_events(recipient_node_id, created_at asc, id asc);
create index if not exists offer_events_offer_created_idx
  on public.offer_events(offer_id, created_at asc);

create table if not exists public.event_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.offer_events(id) on delete cascade,
  node_id uuid not null references public.nodes(id),
  webhook_url text not null,
  attempt_number int not null default 1,
  next_retry_at timestamptz null,
  delivered_at timestamptz null,
  status_code int null,
  ok boolean not null default false,
  error text null,
  created_at timestamptz not null default now()
);

alter table public.event_webhook_deliveries
  add column if not exists attempt_number int not null default 1;
alter table public.event_webhook_deliveries
  add column if not exists next_retry_at timestamptz null;
alter table public.event_webhook_deliveries
  add column if not exists delivered_at timestamptz null;

create index if not exists event_webhook_deliveries_event_idx
  on public.event_webhook_deliveries(event_id, created_at desc);
create index if not exists event_webhook_deliveries_node_created_idx
  on public.event_webhook_deliveries(node_id, created_at desc);
create index if not exists event_webhook_deliveries_next_retry_idx
  on public.event_webhook_deliveries(next_retry_at)
  where next_retry_at is not null and ok = false;

commit;