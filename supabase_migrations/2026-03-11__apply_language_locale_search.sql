begin;

create extension if not exists pg_trgm;

alter table public.nodes
  add column if not exists language_tag text;

alter table public.units
  add column if not exists language_tag text;

alter table public.requests
  add column if not exists language_tag text;

alter table public.offers
  add column if not exists language_tag text;

alter table public.public_listings
  add column if not exists search_text text not null default '';

alter table public.public_requests
  add column if not exists search_text text not null default '';

create or replace function public.fn_public_doc_tags_text(doc jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    (
      select string_agg(elem, ' ')
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(coalesce(doc->'tags', '[]'::jsonb)) = 'array' then doc->'tags'
          else '[]'::jsonb
        end
      ) as elem
    ),
    ''
  );
$$;

create or replace function public.fn_public_doc_to_search_text(doc jsonb)
returns text
language sql
immutable
as $$
  select trim(
    concat_ws(
      ' ',
      coalesce(doc->>'title', ''),
      coalesce(doc->>'public_summary', ''),
      coalesce(doc->>'description', ''),
      public.fn_public_doc_tags_text(doc)
    )
  );
$$;

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
      public.fn_public_doc_tags_text(doc) as tags_text
  )
  select
    setweight(to_tsvector('english', title), 'A')
    || setweight(to_tsvector('english', public_summary), 'B')
    || setweight(to_tsvector('english', description), 'C')
    || setweight(to_tsvector('english', tags_text), 'D')
  from normalized;
$$;

create or replace function public.fn_set_public_projection_search_fields()
returns trigger
language plpgsql
as $$
begin
  new.search_tsv := public.fn_public_doc_to_tsv(new.doc);
  new.search_text := public.fn_public_doc_to_search_text(new.doc);
  return new;
end;
$$;

drop trigger if exists public_listings_search_tsv_update on public.public_listings;
drop trigger if exists public_listings_set_search_tsv on public.public_listings;
drop trigger if exists public_listings_set_search_fields on public.public_listings;
create trigger public_listings_set_search_fields
before insert or update of doc on public.public_listings
for each row execute function public.fn_set_public_projection_search_fields();

drop trigger if exists public_requests_search_tsv_update on public.public_requests;
drop trigger if exists public_requests_set_search_tsv on public.public_requests;
drop trigger if exists public_requests_set_search_fields on public.public_requests;
create trigger public_requests_set_search_fields
before insert or update of doc on public.public_requests
for each row execute function public.fn_set_public_projection_search_fields();

update public.public_listings pl
set
  doc = jsonb_set(coalesce(pl.doc, '{}'::jsonb), '{language_tag}', coalesce(to_jsonb(u.language_tag), 'null'::jsonb), true),
  search_tsv = public.fn_public_doc_to_tsv(jsonb_set(coalesce(pl.doc, '{}'::jsonb), '{language_tag}', coalesce(to_jsonb(u.language_tag), 'null'::jsonb), true)),
  search_text = public.fn_public_doc_to_search_text(jsonb_set(coalesce(pl.doc, '{}'::jsonb), '{language_tag}', coalesce(to_jsonb(u.language_tag), 'null'::jsonb), true))
from public.units u
where u.id = pl.unit_id;

update public.public_requests pr
set
  doc = jsonb_set(coalesce(pr.doc, '{}'::jsonb), '{language_tag}', coalesce(to_jsonb(r.language_tag), 'null'::jsonb), true),
  search_tsv = public.fn_public_doc_to_tsv(jsonb_set(coalesce(pr.doc, '{}'::jsonb), '{language_tag}', coalesce(to_jsonb(r.language_tag), 'null'::jsonb), true)),
  search_text = public.fn_public_doc_to_search_text(jsonb_set(coalesce(pr.doc, '{}'::jsonb), '{language_tag}', coalesce(to_jsonb(r.language_tag), 'null'::jsonb), true))
from public.requests r
where r.id = pr.request_id;

create index if not exists public_listings_search_text_gin
  on public.public_listings
  using gin (search_text gin_trgm_ops);

create index if not exists public_requests_search_text_gin
  on public.public_requests
  using gin (search_text gin_trgm_ops);

commit;
