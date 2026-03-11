do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception 'pg_trgm extension is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'nodes' and column_name = 'language_tag'
  ) then
    raise exception 'nodes.language_tag is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'units' and column_name = 'language_tag'
  ) then
    raise exception 'units.language_tag is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'requests' and column_name = 'language_tag'
  ) then
    raise exception 'requests.language_tag is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'offers' and column_name = 'language_tag'
  ) then
    raise exception 'offers.language_tag is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'public_listings' and column_name = 'search_text'
  ) then
    raise exception 'public_listings.search_text is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'public_requests' and column_name = 'search_text'
  ) then
    raise exception 'public_requests.search_text is missing';
  end if;

  if not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'fn_set_public_projection_search_fields'
  ) then
    raise exception 'fn_set_public_projection_search_fields is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public' and tablename = 'public_listings' and indexname = 'public_listings_search_text_gin'
  ) then
    raise exception 'public_listings_search_text_gin is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public' and tablename = 'public_requests' and indexname = 'public_requests_search_text_gin'
  ) then
    raise exception 'public_requests_search_text_gin is missing';
  end if;
end
$$;
