create table if not exists public.credit_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id),
  code_hash text not null,
  credits_granted int not null check (credits_granted > 0),
  redeemed_at timestamptz not null default now()
);

drop index if exists public.credit_code_redemptions_node_code_unique;

create index if not exists credit_code_redemptions_node_code_idx
  on public.credit_code_redemptions(node_id, code_hash, redeemed_at desc);

create index if not exists credit_code_redemptions_code_redeemed_idx
  on public.credit_code_redemptions(code_hash, redeemed_at desc);

alter table if exists public.credit_ledger
  drop constraint if exists credit_ledger_type_check;

alter table if exists public.credit_ledger
  add constraint credit_ledger_type_check check (type in (
    'grant_signup',
    'grant_trial',
    'grant_milestone_requests',
    'grant_subscription_monthly',
    'grant_referral',
    'grant_promo_code',
    'topup_purchase',
    'debit_search',
    'debit_search_page',
    'deal_accept_fee',
    'debit_broadening',
    'adjustment_manual',
    'reversal'
  ));
