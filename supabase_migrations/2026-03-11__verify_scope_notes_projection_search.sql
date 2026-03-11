do $$
declare
  listings_fn text;
  requests_fn text;
begin
  select pg_get_functiondef('public.fn_public_doc_to_search_text(jsonb)'::regprocedure) into listings_fn;
  if listings_fn not like '%scope_notes%' then
    raise exception 'fn_public_doc_to_search_text does not include scope_notes';
  end if;

  select pg_get_functiondef('public.fn_public_doc_to_tsv(jsonb)'::regprocedure) into requests_fn;
  if requests_fn not like '%scope_notes%' then
    raise exception 'fn_public_doc_to_tsv does not include scope_notes';
  end if;

  if exists (
    select 1
    from public.public_listings pl
    join public.units u on u.id = pl.unit_id
    where u.scope_notes is not null
      and coalesce(pl.doc->>'scope_notes', '') <> u.scope_notes
  ) then
    raise exception 'public_listings scope_notes backfill mismatch';
  end if;

  if exists (
    select 1
    from public.public_requests pr
    join public.requests r on r.id = pr.request_id
    where r.scope_notes is not null
      and coalesce(pr.doc->>'scope_notes', '') <> r.scope_notes
  ) then
    raise exception 'public_requests scope_notes backfill mismatch';
  end if;
end
$$;
