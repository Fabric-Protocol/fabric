-- 2026-02-22: Search ranking schema alignment
-- Adds persisted shipping SLA fields and precomputed FTS vectors for public projections.
-- Safe to re-run.

begin;

alter table public.units
  add column if not exists max_ship_days int;

alter table public.requests
  add column if not exists max_ship_days int;

alter table public.public_listings
  add column if not exists search_tsv tsvector;

alter table public.public_requests
  add column if not exists search_tsv tsvector;

create or replace function public.fn_public_doc_to_tsv(doc jsonb)
returns tsvector
language sql
immutable
as $$
  with normalized as (
    select
      coalesce(doc->>'title', '') as title,
      coalesce(doc->>'public_summary', '') as public_summary,
      coalesce(doc->>'description', '') as description,
      case
        when jsonb_typeof(doc->'tags') = 'array' then coalesce((
          select string_agg(value, ' ')
          from jsonb_array_elements_text(doc->'tags') as t(value)
        ), '')
        else ''
      end as tags_text
  )
  select
    setweight(to_tsvector('english', title), 'A')
    || setweight(to_tsvector('english', public_summary), 'B')
    || setweight(to_tsvector('english', description), 'C')
    || setweight(to_tsvector('english', tags_text), 'D')
  from normalized;
$$;

create or replace function public.fn_set_public_projection_search_tsv()
returns trigger
language plpgsql
as $$
begin
  new.search_tsv := public.fn_public_doc_to_tsv(new.doc);
  return new;
end;
$$;

drop trigger if exists public_listings_set_search_tsv on public.public_listings;
create trigger public_listings_set_search_tsv
before insert or update of doc on public.public_listings
for each row execute function public.fn_set_public_projection_search_tsv();

drop trigger if exists public_requests_set_search_tsv on public.public_requests;
create trigger public_requests_set_search_tsv
before insert or update of doc on public.public_requests
for each row execute function public.fn_set_public_projection_search_tsv();

update public.public_listings
set search_tsv = public.fn_public_doc_to_tsv(doc)
where search_tsv is null;

update public.public_requests
set search_tsv = public.fn_public_doc_to_tsv(doc)
where search_tsv is null;

create index if not exists public_listings_search_tsv_gin
  on public.public_listings
  using gin (search_tsv);

create index if not exists public_requests_search_tsv_gin
  on public.public_requests
  using gin (search_tsv);

commit;