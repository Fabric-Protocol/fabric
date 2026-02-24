-- 2026-02-24: Bcon integration invoice + transaction idempotency tables.

create table if not exists bcon_invoices (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id),
  pack_code text not null,
  credits int not null check (credits > 0),
  chain text not null,
  payment_currency text not null,
  expected_amount numeric not null,
  origin_currency text null,
  origin_amount numeric null,
  address text null,
  status text not null default 'pending' check (status in ('pending','confirmed','failed','expired')),
  txid text null,
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists bcon_invoices add column if not exists pack_code text;
alter table if exists bcon_invoices add column if not exists credits int;
alter table if exists bcon_invoices add column if not exists chain text;
alter table if exists bcon_invoices add column if not exists payment_currency text;
alter table if exists bcon_invoices add column if not exists expected_amount numeric;
alter table if exists bcon_invoices add column if not exists origin_currency text;
alter table if exists bcon_invoices add column if not exists origin_amount numeric;
alter table if exists bcon_invoices add column if not exists address text;
alter table if exists bcon_invoices add column if not exists status text;
alter table if exists bcon_invoices add column if not exists txid text;
alter table if exists bcon_invoices add column if not exists paid_at timestamptz;
alter table if exists bcon_invoices add column if not exists created_at timestamptz not null default now();
alter table if exists bcon_invoices add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='bcon_invoices'
  ) then
    begin
      alter table bcon_invoices alter column node_id set not null;
      alter table bcon_invoices alter column pack_code set not null;
      alter table bcon_invoices alter column credits set not null;
      alter table bcon_invoices alter column chain set not null;
      alter table bcon_invoices alter column payment_currency set not null;
      alter table bcon_invoices alter column expected_amount set not null;
      alter table bcon_invoices alter column status set default 'pending';
      alter table bcon_invoices alter column status set not null;
    exception when others then
      null;
    end;

    alter table bcon_invoices drop constraint if exists bcon_invoices_credits_check;
    alter table bcon_invoices add constraint bcon_invoices_credits_check check (credits > 0);

    alter table bcon_invoices drop constraint if exists bcon_invoices_status_check;
    alter table bcon_invoices add constraint bcon_invoices_status_check check (status in ('pending','confirmed','failed','expired'));
  end if;
end $$;

create index if not exists bcon_invoices_node_idx on bcon_invoices(node_id);
create index if not exists bcon_invoices_status_idx on bcon_invoices(status);

drop trigger if exists bcon_invoices_set_updated_at on bcon_invoices;
create trigger bcon_invoices_set_updated_at
before update on bcon_invoices
for each row execute function set_updated_at();

create table if not exists bcon_txns (
  txid text primary key,
  invoice_id uuid not null references bcon_invoices(id) on delete cascade,
  value numeric null,
  status text null,
  seen_at timestamptz not null default now()
);

alter table if exists bcon_txns add column if not exists invoice_id uuid;
alter table if exists bcon_txns add column if not exists value numeric;
alter table if exists bcon_txns add column if not exists status text;
alter table if exists bcon_txns add column if not exists seen_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='bcon_txns'
  ) then
    begin
      alter table bcon_txns alter column invoice_id set not null;
    exception when others then
      null;
    end;
  end if;
end $$;

create index if not exists bcon_txns_invoice_idx on bcon_txns(invoice_id);
