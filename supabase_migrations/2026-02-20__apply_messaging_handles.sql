-- 2026-02-20: Ensure messaging handle fields required by node profile + reveal-contact output.
-- Safe for repeated execution.

begin;

-- Node profile: unverified user-provided messaging handles.
alter table public.nodes
  add column if not exists messaging_handles jsonb;

alter table public.nodes
  alter column messaging_handles set default '[]'::jsonb;

update public.nodes
set messaging_handles = '[]'::jsonb
where messaging_handles is null;

alter table public.nodes
  alter column messaging_handles set not null;

-- Contact reveal audit: snapshot messaging handles revealed at handoff time.
alter table public.contact_reveals
  add column if not exists revealed_messaging_handles jsonb null;

commit;