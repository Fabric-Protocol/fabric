-- Add DB-backed rate-limit counters and extend offer event enum with offer_rejected.

create table if not exists rate_limit_counters (
  key text primary key,
  count int not null,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists rate_limit_counters_reset_idx on rate_limit_counters(reset_at);

alter table offer_events drop constraint if exists offer_events_event_type_check;
alter table offer_events add constraint offer_events_event_type_check check (event_type in (
  'offer_created',
  'offer_countered',
  'offer_accepted',
  'offer_rejected',
  'offer_cancelled',
  'offer_contact_revealed',
  'subscription_changed',
  'credits_topup_completed'
));
