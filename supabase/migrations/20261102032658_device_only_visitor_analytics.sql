-- This migration removes legacy location data, not visitor records.
-- GPS coordinates and related consent/permission metadata in the dropped columns
-- and any remaining short-lived GPS challenges will be removed; every analytics
-- visit row and device field stays.
-- Run only after reviewing this effect and backing up the target database.
begin;

do $$
declare
  analytics_oid oid := to_regclass('public.visitor_analytics');
  rate_limits_oid oid := to_regclass('public.visitor_analytics_rate_limits');
  gps_challenges_oid oid := to_regclass('public.visitor_analytics_gps_challenges');
  unexpected_policies text;
  invalid_columns text;
  invalid_viewport_values boolean;
  summary_result text;
  summary_function record;
  rate_limit_function record;
  admin_function record;
  admin_function_definition text;
begin
  if analytics_oid is null or not exists (
    select 1 from pg_class where oid = analytics_oid and relkind = 'r'
  ) then
    raise exception 'Device analytics migration requires the existing public.visitor_analytics table; no changes were made.';
  end if;
  if rate_limits_oid is null or not exists (
    select 1 from pg_class where oid = rate_limits_oid and relkind = 'r'
  ) then
    raise exception 'Device analytics migration requires public.visitor_analytics_rate_limits; no changes were made.';
  end if;
  if not exists (select 1 from pg_class where oid = rate_limits_oid and relrowsecurity)
    or not has_table_privilege('service_role', rate_limits_oid, 'SELECT')
    or not has_table_privilege('service_role', rate_limits_oid, 'INSERT')
    or not has_table_privilege('service_role', rate_limits_oid, 'UPDATE')
    or not has_table_privilege('service_role', rate_limits_oid, 'DELETE')
    or has_table_privilege('anon', rate_limits_oid, 'SELECT')
    or has_table_privilege('anon', rate_limits_oid, 'INSERT')
    or has_table_privilege('anon', rate_limits_oid, 'UPDATE')
    or has_table_privilege('anon', rate_limits_oid, 'DELETE')
    or has_table_privilege('authenticated', rate_limits_oid, 'SELECT')
    or has_table_privilege('authenticated', rate_limits_oid, 'INSERT')
    or has_table_privilege('authenticated', rate_limits_oid, 'UPDATE')
    or has_table_privilege('authenticated', rate_limits_oid, 'DELETE') then
    raise exception 'Rate-limit helper access is not service-role-only; review the schema before retrying. No changes were made.';
  end if;

  select string_agg(required.column_name, ', ')
  into invalid_columns
  from (values
    ('id', 'uuid'::regtype),
    ('visit_id', 'uuid'::regtype),
    ('visitor_id', 'uuid'::regtype),
    ('session_id', 'uuid'::regtype),
    ('first_visited_at', 'timestamp with time zone'::regtype),
    ('visited_at', 'timestamp with time zone'::regtype),
    ('page_path', 'text'::regtype),
    ('device_type', 'text'::regtype),
    ('device_brand', 'text'::regtype),
    ('device_model', 'text'::regtype),
    ('operating_system', 'text'::regtype),
    ('os_version', 'text'::regtype),
    ('browser', 'text'::regtype),
    ('browser_version', 'text'::regtype),
    ('screen_width', 'integer'::regtype),
    ('screen_height', 'integer'::regtype),
    ('device_pixel_ratio', 'numeric'::regtype),
    ('language', 'text'::regtype),
    ('created_at', 'timestamp with time zone'::regtype)
  ) as required(column_name, expected_type)
  left join pg_attribute actual
    on actual.attrelid = analytics_oid
    and actual.attname = required.column_name
    and not actual.attisdropped
  where actual.attnum is null or actual.atttypid <> required.expected_type;
  if invalid_columns is not null then
    raise exception 'Device analytics preflight found missing or incompatible columns: %. Review the schema; no changes were made.', invalid_columns;
  end if;

  if not exists (select 1 from pg_class where oid = analytics_oid and relrowsecurity)
    or not has_table_privilege('authenticated', analytics_oid, 'SELECT')
    or not has_table_privilege('authenticated', analytics_oid, 'DELETE')
    or not has_table_privilege('service_role', analytics_oid, 'SELECT')
    or not has_table_privilege('service_role', analytics_oid, 'INSERT')
    or not has_table_privilege('service_role', analytics_oid, 'UPDATE')
    or not has_table_privilege('service_role', analytics_oid, 'DELETE')
    or has_table_privilege('authenticated', analytics_oid, 'INSERT')
    or has_table_privilege('authenticated', analytics_oid, 'UPDATE')
    or has_table_privilege('anon', analytics_oid, 'SELECT')
    or has_table_privilege('anon', analytics_oid, 'INSERT')
    or has_table_privilege('anon', analytics_oid, 'UPDATE')
    or has_table_privilege('anon', analytics_oid, 'DELETE') then
    raise exception 'Device analytics preflight found unexpected RLS or table privileges; no changes were made.';
  end if;

  if not exists (
    select 1 from pg_policy
    where polrelid = analytics_oid
      and polname = 'Admins can read visitor analytics'
      and polcmd = 'r'
      and polpermissive
      and cardinality(polroles) = 1
      and polroles[1] = (select oid from pg_roles where rolname = 'authenticated')
      and regexp_replace(lower(coalesce(pg_get_expr(polqual, polrelid), '')), '[[:space:]()]', '', 'g')
        in ('public.is_admin', 'selectpublic.is_adminasis_admin')
      and polwithcheck is null
  ) or not exists (
    select 1 from pg_policy
    where polrelid = analytics_oid
      and polname = 'Admins can delete visitor analytics'
      and polcmd = 'd'
      and polpermissive
      and cardinality(polroles) = 1
      and polroles[1] = (select oid from pg_roles where rolname = 'authenticated')
      and regexp_replace(lower(coalesce(pg_get_expr(polqual, polrelid), '')), '[[:space:]()]', '', 'g')
        in ('public.is_admin', 'selectpublic.is_adminasis_admin')
      and polwithcheck is null
  ) then
    raise exception 'Expected admin-only SELECT and DELETE policies are missing or changed; no changes were made.';
  end if;

  select string_agg(format('%I', polname), ', ')
  into unexpected_policies
  from pg_policy
  where polrelid = analytics_oid
    and polname not in ('Admins can read visitor analytics', 'Admins can delete visitor analytics');
  if unexpected_policies is not null then
    raise exception 'Unexpected visitor analytics policies require manual review: %. No changes were made.', unexpected_policies;
  end if;

  select prosecdef, provolatile, proconfig
  into admin_function
  from pg_proc
  where oid = to_regprocedure('public.is_admin()');
  select pg_get_functiondef(to_regprocedure('public.is_admin()'))
  into admin_function_definition;
  if not found
    or not admin_function.prosecdef
    or admin_function.provolatile <> 's'
    or not (coalesce(admin_function.proconfig, array[]::text[]) @> array['search_path=public, auth'])
    or (select prorettype from pg_proc where oid = to_regprocedure('public.is_admin()')) <> 'boolean'::regtype
    or position('public.admin_users' in lower(admin_function_definition)) = 0
    or position('auth.uid()' in lower(admin_function_definition)) = 0
    or not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') then
    raise exception 'The existing public.is_admin() authorization contract is missing or changed; no changes were made.';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = analytics_oid and not tgisinternal
  ) then
    raise exception 'Unexpected visitor analytics triggers require manual review; no changes were made.';
  end if;

  select pg_get_function_result(oid)
  into summary_result
  from pg_proc
  where oid = to_regprocedure('public.get_visitor_analytics_summary(timestamptz, timestamptz)');
  if not found or summary_result not in (
    'TABLE(total_visits bigint, unique_visitors bigint, gps_shared_visitors bigint, visitors_without_gps bigint, mobile_visitors bigint, desktop_visitors bigint, tablet_visitors bigint)',
    'TABLE(total_visits bigint, unique_visitors bigint, mobile_visitors bigint, desktop_visitors bigint, tablet_visitors bigint)'
  ) then
    raise exception 'The visitor analytics summary function is missing or has an unexpected return shape; no changes were made.';
  end if;
  select prosecdef, provolatile, proconfig
  into summary_function
  from pg_proc
  where oid = to_regprocedure('public.get_visitor_analytics_summary(timestamptz, timestamptz)');
  if summary_function.prosecdef
    or summary_function.provolatile <> 's'
    or not (coalesce(summary_function.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public, pg_temp']) then
    raise exception 'The visitor analytics summary function has unexpected security settings; no changes were made.';
  end if;

  select prosecdef, provolatile, proconfig
  into rate_limit_function
  from pg_proc
  where oid = to_regprocedure('public.consume_visitor_analytics_rate_limit(text, integer)');
  if not found
    or not rate_limit_function.prosecdef
    or rate_limit_function.provolatile <> 'v'
    or not (coalesce(rate_limit_function.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public, pg_temp'])
    or not has_function_privilege('service_role', 'public.consume_visitor_analytics_rate_limit(text, integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.consume_visitor_analytics_rate_limit(text, integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.consume_visitor_analytics_rate_limit(text, integer)', 'EXECUTE') then
    raise exception 'Rate-limit RPC security settings or grants differ from the expected service-role-only contract; no changes were made.';
  end if;

  if gps_challenges_oid is not null then
    if not exists (select 1 from pg_class where oid = gps_challenges_oid and relkind = 'r') then
      raise exception 'The GPS challenge name conflicts with a non-table object; no changes were made.';
    end if;
    if exists (
      select 1 from pg_trigger where tgrelid = gps_challenges_oid and not tgisinternal
    ) then
      raise exception 'Unexpected GPS challenge triggers require manual review; no changes were made.';
    end if;
    select string_agg(format('%I', polname), ', ')
    into unexpected_policies
    from pg_policy
    where polrelid = gps_challenges_oid;
    if unexpected_policies is not null then
      raise exception 'GPS challenge policies require manual review before removal: %. No changes were made.', unexpected_policies;
    end if;
  end if;

  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname = 'consume_visitor_analytics_gps_challenge'
      and function_row.oid is distinct from to_regprocedure('public.consume_visitor_analytics_gps_challenge(text, uuid, uuid)')
  ) then
    raise exception 'Unexpected overloads of the GPS challenge function require manual review; no changes were made.';
  end if;

  if exists (
    select 1 from pg_attribute
    where attrelid = analytics_oid and attname in ('viewport_width', 'viewport_height')
      and not attisdropped and atttypid <> 'integer'::regtype
  ) then
    raise exception 'Existing viewport columns have an incompatible type; no changes were made.';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = analytics_oid
      and conname in ('visitor_analytics_viewport_width_check', 'visitor_analytics_viewport_height_check')
      and (
        contype <> 'c'
        or (
          conname = 'visitor_analytics_viewport_width_check'
          and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]()]', '', 'g')
            <> 'checkviewport_width>=0andviewport_width<=20000'
        )
        or (
          conname = 'visitor_analytics_viewport_height_check'
          and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]()]', '', 'g')
            <> 'checkviewport_height>=0andviewport_height<=20000'
        )
      )
  ) then
    raise exception 'A viewport constraint name has an unexpected definition; review it before retrying. No changes were made.';
  end if;
  if exists (
    select 1 from pg_attribute
    where attrelid = analytics_oid and attname = 'viewport_width'
      and not attisdropped and atttypid = 'integer'::regtype
  ) then
    execute 'select exists (select 1 from public.visitor_analytics where viewport_width is not null and viewport_width not between 0 and 20000)'
      into invalid_viewport_values;
    if invalid_viewport_values then
      raise exception 'Existing viewport_width values are outside the allowed range; review them before retrying. No changes were made.';
    end if;
  end if;
  if exists (
    select 1 from pg_attribute
    where attrelid = analytics_oid and attname = 'viewport_height'
      and not attisdropped and atttypid = 'integer'::regtype
  ) then
    execute 'select exists (select 1 from public.visitor_analytics where viewport_height is not null and viewport_height not between 0 and 20000)'
      into invalid_viewport_values;
    if invalid_viewport_values then
      raise exception 'Existing viewport_height values are outside the allowed range; review them before retrying. No changes were made.';
    end if;
  end if;
end;
$$;

alter table public.visitor_analytics
  add column if not exists viewport_width integer,
  add column if not exists viewport_height integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and conname = 'visitor_analytics_viewport_width_check'
  ) then
    alter table public.visitor_analytics
      add constraint visitor_analytics_viewport_width_check
      check (viewport_width between 0 and 20000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and conname = 'visitor_analytics_viewport_height_check'
  ) then
    alter table public.visitor_analytics
      add constraint visitor_analytics_viewport_height_check
      check (viewport_height between 0 and 20000);
  end if;
end;
$$;

drop function if exists public.consume_visitor_analytics_gps_challenge(text, uuid, uuid);
drop table if exists public.visitor_analytics_gps_challenges;
drop function public.get_visitor_analytics_summary(timestamptz, timestamptz);

create or replace function public.consume_visitor_analytics_rate_limit(
  p_client_hash text,
  p_limit integer default 100
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  current_count integer;
begin
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$'
    or p_limit is null or p_limit < 1 or p_limit > 300 then
    raise exception 'Invalid rate limit parameters' using errcode = '22023';
  end if;

  delete from public.visitor_analytics_rate_limits
  where window_started_at < now() - interval '1 day';

  insert into public.visitor_analytics_rate_limits (client_hash)
  values (p_client_hash)
  on conflict (client_hash) do update
  set
    request_count = case
      when public.visitor_analytics_rate_limits.window_started_at < now() - interval '1 hour' then 1
      else public.visitor_analytics_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.visitor_analytics_rate_limits.window_started_at < now() - interval '1 hour' then now()
      else public.visitor_analytics_rate_limits.window_started_at
    end
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_visitor_analytics_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.consume_visitor_analytics_rate_limit(text, integer) to service_role;

alter table public.visitor_analytics
  drop constraint if exists visitor_analytics_gps_integrity_check,
  drop constraint if exists visitor_analytics_location_consent_status_check,
  drop constraint if exists visitor_analytics_gps_permission_status_check;

drop index if exists public.visitor_analytics_gps_status_idx;

alter table public.visitor_analytics
  drop column if exists referrer,
  drop column if exists timezone,
  drop column if exists location_consent_status,
  drop column if exists location_consent_version,
  drop column if exists gps_permission_status,
  drop column if exists latitude,
  drop column if exists longitude,
  drop column if exists gps_accuracy,
  drop column if exists gps_collected_at;

create function public.get_visitor_analytics_summary(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  total_visits bigint,
  unique_visitors bigint,
  mobile_visitors bigint,
  desktop_visitors bigint,
  tablet_visitors bigint
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
  select
    count(*)::bigint,
    count(distinct visitor_id)::bigint,
    count(distinct visitor_id) filter (where device_type = 'mobile')::bigint,
    count(distinct visitor_id) filter (where device_type = 'desktop')::bigint,
    count(distinct visitor_id) filter (where device_type = 'tablet')::bigint
  from public.visitor_analytics
  where (p_from is null or visited_at >= p_from)
    and (p_to is null or visited_at < p_to);
end;
$$;

revoke all on function public.get_visitor_analytics_summary(timestamptz, timestamptz) from public, anon;
revoke all on function public.get_visitor_analytics_summary(timestamptz, timestamptz) from authenticated;
grant execute on function public.get_visitor_analytics_summary(timestamptz, timestamptz) to authenticated;

commit;
