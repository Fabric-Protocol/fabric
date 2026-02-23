-- Align credit ledger types with pricing/credits updates.
alter table if exists public.credit_ledger
  drop constraint if exists credit_ledger_type_check;

alter table if exists public.credit_ledger
  add constraint credit_ledger_type_check check (type in (
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
