begin;

create table public.visitor_analytics_consents (
  visitor_id uuid primary key,
  consented_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now()
);

create table public.visitor_analytics (
  visit_id uuid primary key,
  visitor_id uuid not null references public.visitor_analytics_consents (visitor_id) on delete cascade,
  session_id uuid not null,
  page_path text not null check (
    char_length(page_path) between 1 and 512
    and left(page_path, 1) = '/'
    and position('?' in page_path) = 0
    and position('#' in page_path) = 0
  ),
  device_type text not null check (device_type in ('Desktop', 'Mobile', 'Tablet', 'Unknown')),
  operating_system text not null check (
    operating_system in ('Windows 10', 'Windows 11', 'Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Unknown')
  ),
  browser text not null check (
    browser in ('Google Chrome', 'Microsoft Edge', 'Mozilla Firefox', 'Safari', 'Opera', 'Other', 'Unknown')
  ),
  browser_version text check (
    browser_version is null
    or (char_length(browser_version) <= 24 and browser_version ~ '^[0-9]+(\.[0-9]+){0,3}$')
  ),
  screen_category text not null check (
    screen_category in ('Mobile', 'HD', 'Full HD', 'QHD', '4K', 'Other')
  ),
  device_model text not null default 'Unknown' check (
    char_length(device_model) between 1 and 100
  ),
  visited_at timestamptz not null default now()
);

create table public.visitor_analytics_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  last_seen_at timestamptz not null default now()
);

create index visitor_analytics_visited_at_idx
  on public.visitor_analytics (visited_at desc, visit_id desc);
create index visitor_analytics_visitor_id_idx
  on public.visitor_analytics (visitor_id);
create index visitor_analytics_session_id_idx
  on public.visitor_analytics (session_id);
create index visitor_analytics_device_type_idx
  on public.visitor_analytics (device_type, visited_at desc);
create index visitor_analytics_operating_system_idx
  on public.visitor_analytics (operating_system, visited_at desc);
create index visitor_analytics_browser_idx
  on public.visitor_analytics (browser, visited_at desc);
create index visitor_analytics_screen_category_idx
  on public.visitor_analytics (screen_category, visited_at desc);
create index visitor_analytics_rate_limits_last_seen_idx
  on public.visitor_analytics_rate_limits (last_seen_at);
create index visitor_analytics_consents_last_confirmed_idx
  on public.visitor_analytics_consents (last_confirmed_at);

alter table public.visitor_analytics enable row level security;
alter table public.visitor_analytics_consents enable row level security;
alter table public.visitor_analytics_rate_limits enable row level security;

revoke all on table
  public.visitor_analytics,
  public.visitor_analytics_consents,
  public.visitor_analytics_rate_limits
from public, anon, authenticated, service_role;

grant select on public.visitor_analytics to authenticated;
grant insert on public.visitor_analytics to service_role;

create policy "Admins can read visitor analytics"
  on public.visitor_analytics for select to authenticated
  using ((select public.is_admin()));

create function public.record_visitor_analytics_consent(p_visitor_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  consent_limit constant bigint := 100000;
  consent_count bigint;
  existing_consent boolean;
begin
  if p_visitor_id is null then
    raise exception 'Invalid visitor consent identifier'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.visitor_analytics_consents
    where visitor_id = p_visitor_id
      and last_confirmed_at >= now() - interval '90 days'
  ) into existing_consent;

  if not existing_consent then
    perform pg_catalog.pg_advisory_xact_lock(1380140100, 1);
    delete from public.visitor_analytics_consents
    where last_confirmed_at < now() - interval '90 days';

    select exists (
      select 1
      from public.visitor_analytics_consents
      where visitor_id = p_visitor_id
    ) into existing_consent;

    if not existing_consent then
      select count(*) into consent_count
      from public.visitor_analytics_consents;
      if consent_count >= consent_limit then
        raise exception 'Visitor consent storage capacity reached'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.visitor_analytics_consents (visitor_id)
  values (p_visitor_id)
  on conflict (visitor_id) do update
  set last_confirmed_at = now();
end;
$$;

create function public.is_visitor_analytics_consented(p_visitor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.visitor_analytics_consents
    where visitor_id = p_visitor_id
      and last_confirmed_at >= now() - interval '90 days'
  );
$$;

create function public.consume_visitor_analytics_rate_limit(p_ip_hash text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  bucket_limit constant bigint := 50000;
  bucket_count bigint;
  updated_count integer;
  has_bucket boolean;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid visitor analytics rate-limit identifier'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.visitor_analytics_rate_limits
    where ip_hash = p_ip_hash
  ) into has_bucket;

  if not has_bucket then
    perform pg_catalog.pg_advisory_xact_lock(1380140100, 2);
    delete from public.visitor_analytics_rate_limits
    where last_seen_at < now() - interval '1 day';

    select exists (
      select 1
      from public.visitor_analytics_rate_limits
      where ip_hash = p_ip_hash
    ) into has_bucket;

    if not has_bucket then
      select count(*) into bucket_count
      from public.visitor_analytics_rate_limits;
      if bucket_count >= bucket_limit then
        return 'capacity';
      end if;
    end if;
  end if;

  insert into public.visitor_analytics_rate_limits (
    ip_hash,
    window_started_at,
    request_count,
    last_seen_at
  )
  values (p_ip_hash, now(), 1, now())
  on conflict (ip_hash) do update
  set
    request_count = case
      when public.visitor_analytics_rate_limits.window_started_at < now() - interval '1 hour' then 1
      else public.visitor_analytics_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.visitor_analytics_rate_limits.window_started_at < now() - interval '1 hour' then now()
      else public.visitor_analytics_rate_limits.window_started_at
    end,
    last_seen_at = now()
  returning request_count into updated_count;

  if updated_count > 60 then
    return 'limited';
  end if;
  return 'allowed';
end;
$$;

create function public.get_visitor_analytics_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  summary jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_visits', count(*),
    'unique_visitors', count(distinct visitor_id),
    'device_types', (
      select jsonb_object_agg(categories.label, coalesce(counts.visit_count, 0))
      from (values ('Desktop'), ('Mobile'), ('Tablet'), ('Unknown')) as categories(label)
      left join (
        select device_type, count(*) as visit_count
        from public.visitor_analytics
        where visited_at >= now() - interval '90 days'
        group by device_type
      ) as counts on counts.device_type = categories.label
    ),
    'operating_systems', (
      select coalesce(jsonb_agg(jsonb_build_object('label', grouped.operating_system, 'count', grouped.visit_count)
        order by grouped.visit_count desc, grouped.operating_system), '[]'::jsonb)
      from (
        select operating_system, count(*) as visit_count
        from public.visitor_analytics
        where visited_at >= now() - interval '90 days'
        group by operating_system
      ) grouped
    ),
    'browsers', (
      select coalesce(jsonb_agg(jsonb_build_object('label', grouped.browser, 'count', grouped.visit_count)
        order by grouped.visit_count desc, grouped.browser), '[]'::jsonb)
      from (
        select browser, count(*) as visit_count
        from public.visitor_analytics
        where visited_at >= now() - interval '90 days'
        group by browser
      ) grouped
    ),
    'screen_categories', (
      select coalesce(jsonb_agg(jsonb_build_object('label', grouped.screen_category, 'count', grouped.visit_count)
        order by grouped.visit_count desc, grouped.screen_category), '[]'::jsonb)
      from (
        select screen_category, count(*) as visit_count
        from public.visitor_analytics
        where visited_at >= now() - interval '90 days'
        group by screen_category
      ) grouped
    )
  ) into summary
  from public.visitor_analytics
  where visited_at >= now() - interval '90 days';

  return summary;
end;
$$;

create function public.revoke_visitor_analytics_consent(p_visitor_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_visitor_id is null then
    raise exception 'Invalid visitor consent identifier'
      using errcode = '22023';
  end if;

  delete from public.visitor_analytics_consents
  where visitor_id = p_visitor_id;
end;
$$;

revoke all on function public.record_visitor_analytics_consent(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.is_visitor_analytics_consented(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_visitor_analytics_rate_limit(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_visitor_analytics_summary()
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_visitor_analytics_consent(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.record_visitor_analytics_consent(uuid) to service_role;
grant execute on function public.is_visitor_analytics_consented(uuid) to service_role;
grant execute on function public.consume_visitor_analytics_rate_limit(text) to service_role;
grant execute on function public.revoke_visitor_analytics_consent(uuid) to service_role;
grant execute on function public.get_visitor_analytics_summary() to authenticated;

create or replace function public.purge_expired_backend_data()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.inquiries
  where status = 'completed'
    and completed_at < now() - interval '365 days';

  delete from public.contact_rate_limits
  where window_started_at < now() - interval '1 day';

  delete from public.contact_submission_rate_limits
  where last_seen_at < now() - interval '1 day';

  delete from public.visitor_analytics
  where visited_at < now() - interval '90 days';

  delete from public.visitor_analytics_consents
  where last_confirmed_at < now() - interval '90 days';

  delete from public.visitor_analytics_rate_limits
  where last_seen_at < now() - interval '1 day';
end;
$$;

revoke all on function public.purge_expired_backend_data()
  from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_backend_data() to postgres;

comment on table public.visitor_analytics is
  'Consent-gated device visits only. No raw IP, user-agent string, precise screen dimensions, location, or GPS coordinates are stored. Retained for 90 days.';
comment on table public.visitor_analytics_consents is
  'Random visitor IDs with explicit analytics consent; stale records and their visits are deleted after 90 days.';
comment on table public.visitor_analytics_rate_limits is
  'Stores HMAC hashes of verified client IPs only; capped at 50000 rows and pruned after one idle day.';

commit;
