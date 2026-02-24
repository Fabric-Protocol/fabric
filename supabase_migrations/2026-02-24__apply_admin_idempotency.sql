-- 2026-02-24: Admin idempotency storage for admin write endpoint replay/conflict semantics.

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
