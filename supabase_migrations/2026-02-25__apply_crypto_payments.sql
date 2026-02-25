-- Crypto payments tracking table for NOWPayments integration
create table if not exists crypto_payments (
  id            uuid primary key default gen_random_uuid(),
  node_id       uuid not null references nodes(id),
  nowpayments_id bigint unique not null,
  order_id      text unique not null,
  pack_code     text not null,
  credits       int not null,
  price_amount  numeric(12,2) not null,
  price_currency text not null default 'usd',
  pay_currency  text not null,
  pay_address   text not null,
  pay_amount    numeric(24,8) not null,
  actually_paid numeric(24,8),
  status        text not null default 'waiting',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_crypto_payments_node_id on crypto_payments(node_id);
create index if not exists idx_crypto_payments_order_id on crypto_payments(order_id);
