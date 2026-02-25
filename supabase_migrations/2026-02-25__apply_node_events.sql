-- 2026-02-25: Allow node-level events (not tied to offers) in offer_events table.
-- Makes offer_id nullable and adds new event types for subscription changes.
-- Safe to re-run.

begin;

alter table public.offer_events
  alter column offer_id drop not null;

alter table public.offer_events
  drop constraint if exists offer_events_event_type_check;

alter table public.offer_events
  add constraint offer_events_event_type_check
  check (event_type in (
    'offer_created',
    'offer_countered',
    'offer_accepted',
    'offer_cancelled',
    'offer_contact_revealed',
    'subscription_changed',
    'credits_topup_completed'
  ));

commit;
