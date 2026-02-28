
---

## `docs/specs/21__db-ddl.sql`

```sql
-- =========================
-- Extensions
-- =========================
create extension if not exists pgcrypto;

-- =========================
-- Trigger helpers
-- =========================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create or replace function bump_row_version()
returns trigger language plpgsql as $$
begin
  new.row_version = old.row_version + 1;
  return new;
end; $$;

-- =========================
-- Nodes
-- =========================
create table if not exists nodes (
  id uuid primary key default gen_random_uuid(),

  display_name text null,
  email text null,
  email_verified_at timestamptz null,
  recovery_public_key text null,
  phone text null,
  messaging_handles jsonb not null default '[]'::jsonb,
  event_webhook_url text null,
  event_webhook_secret text null,

  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED')),
  suspended_at timestamptz null,
  legal_accepted_at timestamptz not null default now(),
  legal_version text not null default 'legacy',
  legal_ip text null,
  legal_user_agent text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  deleted_at timestamptz null
);

alter table nodes add column if not exists legal_accepted_at timestamptz not null default now();
alter table nodes add column if not exists legal_version text not null default 'legacy';
alter table nodes add column if not exists legal_ip text null;
alter table nodes add column if not exists legal_user_agent text null;
alter table nodes add column if not exists email text null;
alter table nodes add column if not exists email_verified_at timestamptz null;
alter table nodes add column if not exists recovery_public_key text null;
alter table nodes add column if not exists messaging_handles jsonb not null default '[]'::jsonb;
alter table nodes add column if not exists event_webhook_url text null;
alter table nodes add column if not exists event_webhook_secret text null;

create index if not exists nodes_status_idx on nodes(status) where deleted_at is null;
create unique index if not exists nodes_email_unique_idx on nodes(lower(email)) where email is not null and deleted_at is null;
with duplicate_display_names as (
  select
    id,
    row_number() over (partition by lower(display_name) order by created_at asc, id asc) as duplicate_rank
  from nodes
  where display_name is not null
    and deleted_at is null
)
update nodes n
set display_name = n.display_name || '-' || n.id::text
from duplicate_display_names d
where n.id = d.id
  and d.duplicate_rank > 1;
create unique index if not exists nodes_display_name_unique_idx on nodes(lower(display_name)) where display_name is not null and deleted_at is null;

drop trigger if exists nodes_set_updated_at on nodes;
create trigger nodes_set_updated_at
before update on nodes
for each row execute function set_updated_at();

drop trigger if exists nodes_bump_row_version on nodes;
create trigger nodes_bump_row_version
before update on nodes
for each row execute function bump_row_version();

-- =========================
-- API keys
-- =========================
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  label text null,
  key_prefix text not null,
  key_hash text not null,
  last_used_at timestamptz null,
  revoked_at timestamptz null,

  created_at timestamptz not null default now()
);

create unique index if not exists api_keys_key_hash_unique on api_keys(key_hash);
create index if not exists api_keys_node_active_idx on api_keys(node_id, revoked_at);

-- =========================
-- Recovery challenges + events
-- =========================
create table if not exists recovery_challenges (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  type text not null check (type in ('pubkey','email','email_verify')),
  nonce_or_code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  meta jsonb not null default '{}'::jsonb,
  used_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint recovery_challenges_attempts_chk check (attempts >= 0),
  constraint recovery_challenges_max_attempts_chk check (max_attempts > 0)
);

create index if not exists recovery_challenges_node_created_idx on recovery_challenges(node_id, created_at desc);
create index if not exists recovery_challenges_expires_idx on recovery_challenges(expires_at);

create table if not exists recovery_events (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),
  challenge_id uuid null references recovery_challenges(id),
  event_type text not null check (event_type in ('email_verification_completed','api_key_recovery_completed')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists recovery_events_node_created_idx on recovery_events(node_id, created_at desc);

-- =========================
-- Idempotency
-- =========================
create table if not exists idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  key text not null,
  method text not null,
  path text not null,
  request_hash text not null,

  status_code int not null,
  response_json jsonb not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists idempotency_keys_unique on idempotency_keys(node_id, key);
create index if not exists idempotency_keys_expires_idx on idempotency_keys(expires_at);

create table if not exists admin_idempotency_keys (
  id uuid primary key default gen_random_uuid(),

  key text not null,
  method text not null,
  path text not null,
  request_hash text not null,

  status_code int not null,
  response_json jsonb not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists admin_idempotency_keys_unique on admin_idempotency_keys(key, method, path);
create index if not exists admin_idempotency_keys_expires_idx on admin_idempotency_keys(expires_at);

create table if not exists rate_limit_counters (
  key text primary key,
  count int not null,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists rate_limit_counters_reset_idx on rate_limit_counters(reset_at);

-- =========================
-- Subscriptions (Stripe-backed)
-- =========================
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  plan_code text not null check (plan_code in ('free','basic','pro','business')),
  status text not null check (status in (
    'none','active','trialing','past_due','canceled','incomplete','incomplete_expired','unpaid'
  )),

  current_period_start timestamptz null,
  current_period_end timestamptz null,

  stripe_customer_id text null,
  stripe_subscription_id text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_node_unique on subscriptions(node_id);
create unique index if not exists subscriptions_stripe_sub_unique on subscriptions(stripe_subscription_id);

drop trigger if exists subscriptions_set_updated_at on subscriptions;
create trigger subscriptions_set_updated_at
before update on subscriptions
for each row execute function set_updated_at();

-- =========================
-- Credits ledger (authoritative)
-- =========================
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  type text not null check (type in (
    'grant_signup',
    'grant_trial',
    'grant_milestone_requests',
    'grant_subscription_monthly',
    'grant_referral',
    'topup_purchase',
    'debit_search',
    'debit_search_page',
    'deal_accept_fee',
    'debit_broadening',
    'adjustment_manual',
    'reversal'
  )),

  amount int not null, -- positive grants, negative debits
  meta jsonb not null default '{}'::jsonb,

  idempotency_key text null,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_node_created_idx on credit_ledger(node_id, created_at desc);
create unique index if not exists credit_ledger_idem_unique
  on credit_ledger(node_id, idempotency_key)
  where idempotency_key is not null;

-- =========================
-- Trial entitlements (upload bridge)
-- =========================
create table if not exists trial_entitlements (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  source text not null check (source in ('unit_upload_count')),
  threshold_count int not null,
  upload_count_at_grant int not null,

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint trial_entitlements_node_unique unique (node_id),
  constraint trial_entitlements_window_chk check (ends_at > starts_at)
);

create index if not exists trial_entitlements_active_idx on trial_entitlements(node_id, ends_at);

create table if not exists trial_entitlement_events (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),
  event_type text not null check (event_type in ('granted')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'credit_ledger'
  ) then
    alter table credit_ledger drop constraint if exists credit_ledger_type_check;
    alter table credit_ledger add constraint credit_ledger_type_check check (type in (
      'grant_signup',
      'grant_trial',
      'grant_milestone_requests',
      'grant_subscription_monthly',
      'grant_referral',
      'topup_purchase',
      'debit_search',
      'debit_search_page',
      'deal_accept_fee',
      'debit_broadening',
      'adjustment_manual',
      'reversal'
    ));
  end if;
end $$;

create index if not exists trial_entitlement_events_node_created_idx
  on trial_entitlement_events(node_id, created_at desc);

-- =========================
-- Units + Requests (canonical private)
-- =========================
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  title text not null,
  description text null,
  public_summary text null,

  type text null,
  condition text null check (condition in ('new','like_new','good','fair','poor','unknown')),

  quantity numeric null,
  estimated_value numeric null,
  measure text null,
  custom_measure text null,

  scope_primary text null check (scope_primary in ('local_in_person','remote_online_service','ship_to','digital_delivery','OTHER')),
  scope_secondary text[] null,
  scope_notes text null,

  location_text_public text null,

  origin_region jsonb null,
  dest_region jsonb null,
  service_region jsonb null,
  delivery_format text null,
  max_ship_days int null,

  tags text[] null,
  category_ids int[] null,
  photos jsonb null,

  published_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  deleted_at timestamptz null
);

create index if not exists units_node_idx on units(node_id) where deleted_at is null;
create index if not exists units_published_idx on units(published_at desc) where deleted_at is null;
create index if not exists units_scope_idx on units(scope_primary) where deleted_at is null;
alter table units add column if not exists estimated_value numeric null;
alter table units add column if not exists max_ship_days int null;

drop trigger if exists units_set_updated_at on units;
create trigger units_set_updated_at
before update on units
for each row execute function set_updated_at();

drop trigger if exists units_bump_row_version on units;
create trigger units_bump_row_version
before update on units
for each row execute function bump_row_version();

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  title text not null,
  description text null,
  public_summary text null,

  type text null,
  condition text null check (condition in ('new','like_new','good','fair','poor','unknown')),

  desired_quantity numeric null,
  measure text null,
  custom_measure text null,

  scope_primary text null check (scope_primary in ('local_in_person','remote_online_service','ship_to','digital_delivery','OTHER')),
  scope_secondary text[] null,
  scope_notes text null,

  location_text_public text null,

  origin_region jsonb null,
  dest_region jsonb null,
  service_region jsonb null,
  delivery_format text null,
  max_ship_days int null,

  need_by timestamptz null,
  accept_substitutions boolean not null default true,
  expires_at timestamptz not null default (now() + interval '7 days'),

  tags text[] null,
  category_ids int[] null,

  published_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  deleted_at timestamptz null
);

-- 365 days default for early marketplace density; reduce to '7 days' once volume is healthy
alter table requests add column if not exists expires_at timestamptz not null default (now() + interval '365 days');
alter table requests add column if not exists max_ship_days int null;

create index if not exists requests_node_idx on requests(node_id) where deleted_at is null;
create index if not exists requests_published_idx on requests(published_at desc) where deleted_at is null;
create index if not exists requests_scope_idx on requests(scope_primary) where deleted_at is null;
create index if not exists requests_expires_idx on requests(expires_at) where deleted_at is null;

drop trigger if exists requests_set_updated_at on requests;
create trigger requests_set_updated_at
before update on requests
for each row execute function set_updated_at();

drop trigger if exists requests_bump_row_version on requests;
create trigger requests_bump_row_version
before update on requests
for each row execute function bump_row_version();

-- =========================
-- Projections (public)
-- =========================
create table if not exists public_listings (
  unit_id uuid primary key references units(id) on delete cascade,
  node_id uuid not null references nodes(id),

  doc jsonb not null, -- allowlisted PublicListing payload
  search_tsv tsvector not null default ''::tsvector,
  published_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public_listings add column if not exists search_tsv tsvector not null default ''::tsvector;

create index if not exists public_listings_published_idx on public_listings(published_at desc);
create index if not exists public_listings_search_tsv_idx on public_listings using gin(search_tsv);

create or replace function public_listings_tsv_trigger() returns trigger language plpgsql as $$
begin
  new.search_tsv := to_tsvector('english',
    coalesce(new.doc->>'title','') || ' ' ||
    coalesce(new.doc->>'public_summary','') || ' ' ||
    coalesce(new.doc->>'description','') || ' ' ||
    coalesce(
      (select string_agg(elem, ' ') from jsonb_array_elements_text(
        case when jsonb_typeof(coalesce(new.doc->'tags','[]'::jsonb)) = 'array'
             then new.doc->'tags' else '[]'::jsonb end
      ) as elem),
      ''
    )
  );
  return new;
end; $$;

drop trigger if exists public_listings_search_tsv_update on public_listings;
create trigger public_listings_search_tsv_update
before insert or update on public_listings
for each row execute function public_listings_tsv_trigger();

create table if not exists public_requests (
  request_id uuid primary key references requests(id) on delete cascade,
  node_id uuid not null references nodes(id),

  doc jsonb not null, -- allowlisted PublicRequest payload
  search_tsv tsvector not null default ''::tsvector,
  published_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public_requests add column if not exists search_tsv tsvector not null default ''::tsvector;

create index if not exists public_requests_published_idx on public_requests(published_at desc);
create index if not exists public_requests_search_tsv_idx on public_requests using gin(search_tsv);

create or replace function public_requests_tsv_trigger() returns trigger language plpgsql as $$
begin
  new.search_tsv := to_tsvector('english',
    coalesce(new.doc->>'title','') || ' ' ||
    coalesce(new.doc->>'public_summary','') || ' ' ||
    coalesce(new.doc->>'description','') || ' ' ||
    coalesce(
      (select string_agg(elem, ' ') from jsonb_array_elements_text(
        case when jsonb_typeof(coalesce(new.doc->'tags','[]'::jsonb)) = 'array'
             then new.doc->'tags' else '[]'::jsonb end
      ) as elem),
      ''
    )
  );
  return new;
end; $$;

drop trigger if exists public_requests_search_tsv_update on public_requests;
create trigger public_requests_search_tsv_update
before insert or update on public_requests
for each row execute function public_requests_tsv_trigger();

-- =========================
-- Offers + holds
-- =========================
create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,

  from_node_id uuid not null references nodes(id),
  to_node_id uuid not null references nodes(id),

  unit_id uuid null references units(id),
  request_id uuid null references requests(id),

  status text not null check (status in (
    'pending','accepted_by_a','accepted_by_b','mutually_accepted',
    'rejected','cancelled','countered','expired'
  )),

  expires_at timestamptz not null,

  accepted_by_from_at timestamptz null,
  accepted_by_to_at timestamptz null,
  mutually_accepted_at timestamptz null,
  rejected_at timestamptz null,
  rejection_reason text null,
  cancelled_at timestamptz null,
  countered_at timestamptz null,
  expired_at timestamptz null,

  note text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  deleted_at timestamptz null,

  constraint offers_target_xor_chk check ((unit_id is null) <> (request_id is null))
);

create index if not exists offers_thread_idx on offers(thread_id, created_at);
create index if not exists offers_to_status_idx on offers(to_node_id, status) where deleted_at is null;
create index if not exists offers_from_status_idx on offers(from_node_id, status) where deleted_at is null;

drop trigger if exists offers_set_updated_at on offers;
create trigger offers_set_updated_at
before update on offers
for each row execute function set_updated_at();

drop trigger if exists offers_bump_row_version on offers;
create trigger offers_bump_row_version
before update on offers
for each row execute function bump_row_version();

create table if not exists offer_lines (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers(id) on delete cascade,
  unit_id uuid not null references units(id),
  created_at timestamptz not null default now(),

  constraint offer_lines_unique_unit_per_offer unique (offer_id, unit_id)
);

create table if not exists holds (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers(id) on delete cascade,
  unit_id uuid not null references units(id),

  status text not null check (status in ('active','released','committed','expired')),
  expires_at timestamptz not null,

  released_at timestamptz null,
  committed_at timestamptz null,
  expired_at timestamptz null,

  created_at timestamptz not null default now()
);

create index if not exists holds_unit_status_idx on holds(unit_id, status);
create index if not exists holds_active_expires_idx on holds(expires_at) where status='active';

-- =========================
-- Contact reveal audit
-- =========================
create table if not exists contact_reveals (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers(id),
  requesting_node_id uuid not null references nodes(id),
  revealed_node_id uuid not null references nodes(id),

  revealed_email text null,
  revealed_phone text null,
  revealed_messaging_handles jsonb null,

  created_at timestamptz not null default now()
);

alter table contact_reveals add column if not exists revealed_messaging_handles jsonb null;

create index if not exists contact_reveals_offer_idx on contact_reveals(offer_id);

create table if not exists offer_events (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid null references offers(id) on delete cascade,
  event_type text not null check (event_type in (
    'offer_created',
    'offer_countered',
    'offer_accepted',
    'offer_rejected',
    'offer_cancelled',
    'offer_contact_revealed',
    'subscription_changed',
    'credits_topup_completed'
  )),
  actor_node_id uuid not null references nodes(id),
  recipient_node_id uuid not null references nodes(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists offer_events_recipient_created_idx on offer_events(recipient_node_id, created_at asc, id asc);
create index if not exists offer_events_offer_created_idx on offer_events(offer_id, created_at asc);

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

create table if not exists event_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references offer_events(id) on delete cascade,
  node_id uuid not null references nodes(id),
  webhook_url text not null,
  attempt_number int not null default 1,
  next_retry_at timestamptz null,
  delivered_at timestamptz null,
  status_code int null,
  ok boolean not null default false,
  error text null,
  created_at timestamptz not null default now()
);

alter table event_webhook_deliveries add column if not exists attempt_number int not null default 1;
alter table event_webhook_deliveries add column if not exists next_retry_at timestamptz null;
alter table event_webhook_deliveries add column if not exists delivered_at timestamptz null;

create index if not exists event_webhook_deliveries_event_idx on event_webhook_deliveries(event_id, created_at desc);
create index if not exists event_webhook_deliveries_node_created_idx on event_webhook_deliveries(node_id, created_at desc);
create index if not exists event_webhook_deliveries_next_retry_idx on event_webhook_deliveries(next_retry_at) where next_retry_at is not null and ok=false;

-- =========================
-- Referrals
-- =========================
create table if not exists referral_codes (
  code text primary key,
  issuer_node_id uuid not null references nodes(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists referral_claims (
  id uuid primary key default gen_random_uuid(),
  code text not null references referral_codes(code),
  claimer_node_id uuid not null references nodes(id),
  issuer_node_id uuid not null references nodes(id),

  status text not null check (status in ('claimed','awarded','rejected')),
  claimed_at timestamptz not null default now(),
  awarded_at timestamptz null,
  rejected_at timestamptz null,
  rejection_reason text null
);

create unique index if not exists referral_claims_one_per_node_unique on referral_claims(claimer_node_id);
create index if not exists referral_claims_issuer_idx on referral_claims(issuer_node_id, claimed_at desc);

-- =========================
-- Stripe events (idempotent webhook processing)
-- =========================
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  processing_error text null
);

-- =========================
-- Search logs (redacted)
-- =========================
create table if not exists search_logs (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),

  kind text not null check (kind in ('listings','requests')),
  scope text not null,
  query_redacted text null,
  query_hash text null,
  filters_json jsonb null,

  page_count int not null default 1,
  broadening_level int not null default 0,
  credits_charged int not null,

  created_at timestamptz not null default now()
);

create index if not exists search_logs_node_created_idx on search_logs(node_id, created_at desc);

-- =========================
-- Visibility events
-- =========================
create table if not exists visibility_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('search_impression','detail_view')),
  viewer_node_id uuid not null references nodes(id),
  subject_kind text not null check (subject_kind in ('listing','request')),
  item_id uuid not null,
  search_id uuid null,
  position int null,
  scope text null,
  created_at timestamptz not null default now()
);

create index if not exists visibility_events_viewer_created_idx on visibility_events(viewer_node_id, created_at desc);
create index if not exists visibility_events_type_created_idx on visibility_events(event_type, created_at desc);
create index if not exists visibility_events_item_type_created_idx on visibility_events(item_id, event_type, created_at desc);

-- =========================
-- Admin takedowns (reversible)
-- =========================
create table if not exists takedowns (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('listing','request','node')),
  target_id uuid not null,

  reason text not null,
  notes text null,

  created_at timestamptz not null default now(),
  reversed_at timestamptz null,
  reversed_reason text null
);

create index if not exists takedowns_target_idx on takedowns(target_type, target_id);
