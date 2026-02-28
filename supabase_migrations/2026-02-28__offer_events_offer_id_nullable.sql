-- Ensure node-level events can be persisted in offer_events without an offer_id.
-- Safe to re-run.

begin;

alter table public.offer_events
  alter column offer_id drop not null;

commit;
