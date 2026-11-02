-- Permanently removes visitor analytics records, including device and GPS data.
begin;

do $$
declare
  conflicting_relations text;
begin
  select string_agg(format('%I (%s)', relation.relname, relation.relkind), ', ')
  into conflicting_relations
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (
      'visitor_analytics',
      'visitor_analytics_rate_limits',
      'visitor_analytics_gps_challenges'
    )
    and relation.relkind <> 'r';

  if conflicting_relations is not null then
    raise exception 'Analytics cleanup stopped: expected ordinary analytics tables, found %.', conflicting_relations;
  end if;

  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname in (
        'consume_visitor_analytics_rate_limit',
        'consume_visitor_analytics_gps_challenge',
        'get_visitor_analytics_summary',
        'purge_visitor_analytics_older_than'
      )
      and not coalesce(
        function_row.oid = to_regprocedure('public.consume_visitor_analytics_rate_limit(text, integer)')
        or function_row.oid = to_regprocedure('public.consume_visitor_analytics_gps_challenge(text, uuid, uuid)')
        or function_row.oid = to_regprocedure('public.get_visitor_analytics_summary(timestamptz, timestamptz)')
        or function_row.oid = to_regprocedure('public.purge_visitor_analytics_older_than(integer)'),
        false
      )
  ) then
    raise exception 'Analytics cleanup stopped: unexpected overloads of analytics RPC functions require manual review.';
  end if;

  if exists (
    select 1
    from pg_constraint foreign_key
    join pg_class dependent_table on dependent_table.oid = foreign_key.conrelid
    join pg_namespace dependent_schema on dependent_schema.oid = dependent_table.relnamespace
    join pg_class target_table on target_table.oid = foreign_key.confrelid
    join pg_namespace target_schema on target_schema.oid = target_table.relnamespace
    where foreign_key.contype = 'f'
      and target_schema.nspname = 'public'
      and target_table.relname in (
        'visitor_analytics',
        'visitor_analytics_rate_limits',
        'visitor_analytics_gps_challenges'
      )
      and not (
        dependent_schema.nspname = 'public'
        and dependent_table.relname in (
          'visitor_analytics',
          'visitor_analytics_rate_limits',
          'visitor_analytics_gps_challenges'
        )
      )
  ) then
    raise exception 'Analytics cleanup stopped: an unrelated table references an analytics table.';
  end if;

  if exists (
    select 1
    from pg_trigger trigger_row
    join pg_class trigger_table on trigger_table.oid = trigger_row.tgrelid
    join pg_namespace trigger_schema on trigger_schema.oid = trigger_table.relnamespace
    where trigger_schema.nspname = 'public'
      and trigger_table.relname in (
        'visitor_analytics',
        'visitor_analytics_rate_limits',
        'visitor_analytics_gps_challenges'
      )
      and not trigger_row.tgisinternal
  ) then
    raise exception 'Analytics cleanup stopped: unexpected triggers on analytics tables require manual review.';
  end if;
end;
$$;

drop function if exists public.consume_visitor_analytics_rate_limit(text, integer);
drop function if exists public.consume_visitor_analytics_gps_challenge(text, uuid, uuid);
drop function if exists public.get_visitor_analytics_summary(timestamptz, timestamptz);
drop function if exists public.purge_visitor_analytics_older_than(integer);

drop table if exists public.visitor_analytics;
drop table if exists public.visitor_analytics_rate_limits;
drop table if exists public.visitor_analytics_gps_challenges;

commit;
