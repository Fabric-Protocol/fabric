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
      coalesce(doc->>'scope_notes', ''),
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
      coalesce(doc->>'scope_notes', '') as scope_notes,
      public.fn_public_doc_tags_text(doc) as tags_text
  )
  select
    setweight(to_tsvector('english', title), 'A')
    || setweight(to_tsvector('english', public_summary), 'B')
    || setweight(to_tsvector('english', description), 'C')
    || setweight(to_tsvector('english', scope_notes), 'C')
    || setweight(to_tsvector('english', tags_text), 'D')
  from normalized;
$$;

update public.public_listings pl
set doc = jsonb_set(
  coalesce(pl.doc, '{}'::jsonb),
  '{scope_notes}',
  coalesce(to_jsonb(u.scope_notes), 'null'::jsonb),
  true
)
from public.units u
where u.id = pl.unit_id
  and (pl.doc->>'scope_notes') is distinct from u.scope_notes;

update public.public_requests pr
set doc = jsonb_set(
  coalesce(pr.doc, '{}'::jsonb),
  '{scope_notes}',
  coalesce(to_jsonb(r.scope_notes), 'null'::jsonb),
  true
)
from public.requests r
where r.id = pr.request_id
  and (pr.doc->>'scope_notes') is distinct from r.scope_notes;
