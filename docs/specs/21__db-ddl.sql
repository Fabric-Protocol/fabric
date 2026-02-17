
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
  phone text null,

  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED')),
  suspended_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  deleted_at timestamptz null
);

create index if not exists nodes_status_idx on nodes(status) where deleted_at is null;

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
    'grant_subscription_monthly',
    'grant_referral',
    'topup_purchase',
    'debit_search',
    'debit_search_page',
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

  need_by timestamptz null,
  accept_substitutions boolean not null default true,

  tags text[] null,
  category_ids int[] null,

  published_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  deleted_at timestamptz null
);

create index if not exists requests_node_idx on requests(node_id) where deleted_at is null;
create index if not exists requests_published_idx on requests(published_at desc) where deleted_at is null;
create index if not exists requests_scope_idx on requests(scope_primary) where deleted_at is null;

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
  published_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists public_listings_published_idx on public_listings(published_at desc);

create table if not exists public_requests (
  request_id uuid primary key references requests(id) on delete cascade,
  node_id uuid not null references nodes(id),

  doc jsonb not null, -- allowlisted PublicRequest payload
  published_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists public_requests_published_idx on public_requests(published_at desc);

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

  created_at timestamptz not null default now()
);

create index if not exists contact_reveals_offer_idx on contact_reveals(offer_id);

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
