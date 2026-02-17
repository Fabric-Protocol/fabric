-- Supabase schema sync for Fabric API legal assent fields on nodes.
-- Idempotent: safe to run multiple times.

begin;

alter table public.nodes add column if not exists legal_accepted_at timestamptz;
alter table public.nodes add column if not exists legal_version text;
alter table public.nodes add column if not exists legal_ip text;
alter table public.nodes add column if not exists legal_user_agent text;

update public.nodes
set legal_accepted_at = coalesce(legal_accepted_at, created_at, now()),
    legal_version = coalesce(nullif(legal_version, ''), 'legacy')
where legal_accepted_at is null
   or legal_version is null
   or legal_version = '';

alter table public.nodes alter column legal_accepted_at set default now();
alter table public.nodes alter column legal_version set default 'legacy';
alter table public.nodes alter column legal_accepted_at set not null;
alter table public.nodes alter column legal_version set not null;

commit;
