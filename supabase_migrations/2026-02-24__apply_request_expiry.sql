-- 2026-02-24: Request expiry schema alignment

alter table if exists requests
  add column if not exists expires_at timestamptz;

update requests
set expires_at = coalesce(expires_at, created_at + interval '7 days')
where expires_at is null;

alter table if exists requests
  alter column expires_at set default (now() + interval '7 days');

alter table if exists requests
  alter column expires_at set not null;

create index if not exists requests_expires_idx on requests(expires_at) where deleted_at is null;
