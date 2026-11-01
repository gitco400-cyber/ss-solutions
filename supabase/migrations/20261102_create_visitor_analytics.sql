-- Run all checks that inspect pre-existing analytics objects before DDL, grants,
-- backfills, constraint changes, or index creation. Existing visitor records are
-- never silently assigned replacement identifiers or have GPS values rewritten.
-- This file does not establish a transaction boundary. Do not assume a migration
-- runner will roll back every earlier statement if a later statement fails.
do $$
declare
  admin_table_oid oid := to_regclass('public.admin_users');
  admin_function record;
  admin_function_definition text;
begin
  if admin_table_oid is null then
    raise exception 'Missing prerequisite public.admin_users. Apply and verify the existing admin schema before this migration.';
  end if;
  if not exists (
    select 1
    from pg_attribute
    where attrelid = admin_table_oid
      and attname = 'user_id'
      and atttypid = 'uuid'::regtype
      and not attisdropped
  ) then
    raise exception 'public.admin_users.user_id must exist with type uuid; no analytics objects were changed.';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = admin_table_oid and relrowsecurity
  ) then
    raise exception 'public.admin_users must have RLS enabled before analytics can be installed.';
  end if;
  if not has_table_privilege('authenticated', admin_table_oid, 'SELECT') then
    raise exception 'Authenticated users need the existing admin_users SELECT privilege for admin verification.';
  end if;
  if not exists (
    select 1
    from pg_policy policy_row
    where policy_row.polrelid = admin_table_oid
      and policy_row.polcmd = 'r'
      and policy_row.polpermissive
      and cardinality(policy_row.polroles) = 1
      and policy_row.polroles[1] = (select oid from pg_roles where rolname = 'authenticated')
      and regexp_replace(
        lower(coalesce(pg_get_expr(policy_row.polqual, policy_row.polrelid), '')),
        '[[:space:]()]', '', 'g'
      ) = 'user_id=auth.uid'
  ) then
    raise exception 'The existing admin_users self-membership SELECT policy is missing or differs from the expected user_id = auth.uid() rule.';
  end if;

  select prosecdef, provolatile, prorettype, pronargs, proconfig
  into admin_function
  from pg_proc
  where oid = to_regprocedure('public.is_admin()');
  if not found then
    raise exception 'public.is_admin() is missing; apply and verify the existing admin schema first.';
  end if;
  if not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') then
    raise exception 'Authenticated users need the existing is_admin() execution privilege for admin authorization.';
  end if;
  select pg_get_functiondef(to_regprocedure('public.is_admin()'))
  into admin_function_definition;
  if not admin_function.prosecdef
    or admin_function.provolatile <> 's'
    or admin_function.prorettype <> 'boolean'::regtype
    or admin_function.pronargs <> 0
    or not (coalesce(admin_function.proconfig, array[]::text[]) @> array['search_path=public, auth'])
    or position('public.admin_users' in lower(admin_function_definition)) = 0
    or position('auth.uid()' in lower(admin_function_definition)) = 0 then
    raise exception 'public.is_admin() is missing or does not match the required stable SECURITY DEFINER and pinned search_path contract.';
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
    raise exception 'Unexpected overloads of visitor analytics RPC functions exist in public; review their permissions before retrying.';
  end if;

  if exists (
    select 1
    from pg_proc function_row
    where function_row.oid = to_regprocedure('public.consume_visitor_analytics_rate_limit(text, integer)')
      and (function_row.prorettype <> 'boolean'::regtype or function_row.proretset)
  ) or exists (
    select 1
    from pg_proc function_row
    where function_row.oid = to_regprocedure('public.consume_visitor_analytics_gps_challenge(text, uuid, uuid)')
      and (function_row.prorettype <> 'boolean'::regtype or function_row.proretset)
  ) or exists (
    select 1
    from pg_proc function_row
    where function_row.oid = to_regprocedure('public.get_visitor_analytics_summary(timestamptz, timestamptz)')
      and (
        function_row.prorettype <> 'record'::regtype
        or not function_row.proretset
        or pg_get_function_result(function_row.oid) <>
          'TABLE(total_visits bigint, unique_visitors bigint, gps_shared_visitors bigint, visitors_without_gps bigint, mobile_visitors bigint, desktop_visitors bigint, tablet_visitors bigint)'
      )
  ) or exists (
    select 1
    from pg_proc function_row
    where function_row.oid = to_regprocedure('public.purge_visitor_analytics_older_than(integer)')
      and (function_row.prorettype <> 'bigint'::regtype or function_row.proretset)
  ) then
    raise exception 'An existing visitor analytics RPC has an incompatible return type. Review the function signature before retrying; no analytics objects were changed.';
  end if;
end;
$$;

do $$
declare
  table_oid oid;
  table_rows bigint;
  missing_columns text;
  incompatible_columns text;
  invalid_rows bigint;
  duplicate_groups bigint;
  unexpected_policies text;
  unexpected_triggers text;
  existing_index record;
  expected_index record;
begin
  table_oid := to_regclass('public.visitor_analytics');
  if table_oid is null then
    for expected_index in
      select * from (values
        ('visitor_analytics_visit_id_idx'),
        ('visitor_analytics_visited_at_idx'),
        ('visitor_analytics_visitor_id_idx'),
        ('visitor_analytics_device_type_idx'),
        ('visitor_analytics_gps_status_idx')
      ) as expected(name)
    loop
      if exists (
        select 1
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public' and relation.relname = expected_index.name
      ) then
        raise exception 'Preflight stopped: public.% already exists but visitor_analytics does not. Review this schema conflict before retrying.', expected_index.name;
      end if;
    end loop;
  end if;
  if table_oid is not null then
    if not exists (select 1 from pg_class where oid = table_oid and relkind = 'r') then
      raise exception 'public.visitor_analytics exists but is not an ordinary table; review the conflicting object before retrying.';
    end if;

    execute 'select count(*) from public.visitor_analytics' into table_rows;

    select string_agg(required.column_name, ', ')
    into missing_columns
    from (values
      ('id'), ('visitor_id'), ('session_id'), ('first_visited_at'), ('visited_at'),
      ('page_path'), ('referrer'), ('device_type'), ('device_brand'), ('device_model'),
      ('operating_system'), ('os_version'), ('browser'), ('browser_version'),
      ('screen_width'), ('screen_height'), ('device_pixel_ratio'), ('language'),
      ('timezone'), ('gps_permission_status'), ('latitude'), ('longitude'),
      ('gps_accuracy'), ('gps_collected_at'), ('created_at')
    ) as required(column_name)
    left join pg_attribute actual
      on actual.attrelid = table_oid
      and actual.attname = required.column_name
      and not actual.attisdropped
    where actual.attnum is null;
    if missing_columns is not null then
      raise exception 'Existing public.visitor_analytics is missing required columns: %. Resolve the schema conflict manually; no records were changed.', missing_columns;
    end if;

    select string_agg(required.column_name, ', ')
    into missing_columns
    from (values
      ('visit_id'), ('location_consent_status'), ('location_consent_version')
    ) as required(column_name)
    left join pg_attribute actual
      on actual.attrelid = table_oid
      and actual.attname = required.column_name
      and not actual.attisdropped
    where actual.attnum is null;
    if missing_columns is not null and table_rows > 0 then
      raise exception 'Existing public.visitor_analytics contains % records but lacks required migration columns: %. Review and explicitly migrate those records before retrying; this migration will not generate replacement values.', table_rows, missing_columns;
    end if;

    select string_agg(required.column_name, ', ')
    into incompatible_columns
    from (values
      ('id', 'uuid'::regtype), ('visit_id', 'uuid'::regtype),
      ('visitor_id', 'uuid'::regtype), ('session_id', 'uuid'::regtype),
      ('first_visited_at', 'timestamp with time zone'::regtype),
      ('visited_at', 'timestamp with time zone'::regtype),
      ('page_path', 'text'::regtype), ('referrer', 'text'::regtype),
      ('device_type', 'text'::regtype), ('device_brand', 'text'::regtype),
      ('device_model', 'text'::regtype), ('operating_system', 'text'::regtype),
      ('os_version', 'text'::regtype), ('browser', 'text'::regtype),
      ('browser_version', 'text'::regtype), ('screen_width', 'integer'::regtype),
      ('screen_height', 'integer'::regtype), ('device_pixel_ratio', 'numeric'::regtype),
      ('language', 'text'::regtype), ('timezone', 'text'::regtype),
      ('location_consent_status', 'text'::regtype),
      ('location_consent_version', 'uuid'::regtype), ('gps_permission_status', 'text'::regtype),
      ('latitude', 'double precision'::regtype), ('longitude', 'double precision'::regtype),
      ('gps_accuracy', 'numeric'::regtype), ('gps_collected_at', 'timestamp with time zone'::regtype),
      ('created_at', 'timestamp with time zone'::regtype)
    ) as required(column_name, expected_type)
    left join pg_attribute actual
      on actual.attrelid = table_oid
      and actual.attname = required.column_name
      and not actual.attisdropped
    where actual.attnum is not null
      and actual.atttypid <> required.expected_type;
    if incompatible_columns is not null then
      raise exception 'Existing public.visitor_analytics has incompatible column types: %. Review the schema manually; no records were changed.', incompatible_columns;
    end if;

    if exists (
      select 1 from pg_attribute
      where attrelid = table_oid and attname = 'visit_id' and not attisdropped
    ) then
      execute 'select count(*) from (select visit_id from public.visitor_analytics where visit_id is not null group by visit_id having count(*) > 1) duplicate_ids'
      into duplicate_groups;
      if duplicate_groups > 0 then
        raise exception 'Preflight stopped: % duplicate visit_id groups exist in public.visitor_analytics. Resolve duplicates without deleting visits, then retry.', duplicate_groups;
      end if;
    end if;

    if missing_columns is null then
      execute $query$
        select count(*)
        from public.visitor_analytics
        where (
          id is null or visit_id is null or visitor_id is null or session_id is null
          or visited_at is null or page_path is null or device_type is null
          or device_brand is null or device_model is null or operating_system is null
          or os_version is null or browser is null or browser_version is null
          or language is null or timezone is null or location_consent_status is null
          or location_consent_version is null or gps_permission_status is null or created_at is null
          or location_consent_status not in ('not_asked', 'declined', 'consented', 'revoked')
          or gps_permission_status not in ('not_requested', 'granted', 'denied', 'unavailable', 'error', 'revoked')
        )
      $query$ into invalid_rows;
      if invalid_rows > 0 then
        raise exception 'Preflight stopped: % public.visitor_analytics records contain NULL values in required columns. Review and manually remediate these records before retrying; no records were changed.', invalid_rows;
      end if;

      execute $query$
        select count(*)
        from public.visitor_analytics
        where (
          (
            latitude is null and longitude is null
            and gps_accuracy is null and gps_collected_at is null
          )
          or (
            latitude is not null and longitude is not null
            and gps_accuracy is not null and gps_collected_at is not null
            and latitude between -90 and 90
            and longitude between -180 and 180
            and gps_accuracy >= 0
            and gps_accuracy < 'Infinity'::numeric
            and gps_permission_status = 'granted'
            and location_consent_status = 'consented'
          )
        ) is not true
      $query$ into invalid_rows;
      if invalid_rows > 0 then
        raise exception 'Preflight stopped: % public.visitor_analytics records contain incomplete, out-of-range, or inconsistent GPS tuples/status. Review and manually clear/revoke only approved GPS fields before retrying; no records were changed.', invalid_rows;
      end if;
    end if;

    select string_agg(trigger_row.tgname, ', ')
    into unexpected_triggers
    from pg_trigger trigger_row
    where trigger_row.tgrelid = table_oid and not trigger_row.tgisinternal;
    if unexpected_triggers is not null then
      raise exception 'Preflight stopped: unexpected triggers exist on public.visitor_analytics: %. Review them before retrying.', unexpected_triggers;
    end if;

    if exists (
      select 1 from pg_constraint
      where conrelid = table_oid and conname = 'visitor_analytics_gps_integrity_check'
        and (
          contype <> 'c'
          or pg_get_constraintdef(oid) not ilike '%latitude IS NULL%'
          or pg_get_constraintdef(oid) not ilike '%longitude IS NULL%'
          or pg_get_constraintdef(oid) not ilike '%gps_accuracy IS NULL%'
          or pg_get_constraintdef(oid) not ilike '%gps_collected_at IS NULL%'
          or pg_get_constraintdef(oid) not ilike '%latitude IS NOT NULL%'
          or pg_get_constraintdef(oid) not ilike '%longitude IS NOT NULL%'
          or pg_get_constraintdef(oid) not ilike '%gps_accuracy IS NOT NULL%'
          or pg_get_constraintdef(oid) not ilike '%gps_collected_at IS NOT NULL%'
          or pg_get_constraintdef(oid) not ilike '%latitude >=%'
          or pg_get_constraintdef(oid) not ilike '%latitude <=%'
          or pg_get_constraintdef(oid) not ilike '%longitude >=%'
          or pg_get_constraintdef(oid) not ilike '%longitude <=%'
          or pg_get_constraintdef(oid) not ilike '%gps_accuracy >=%'
          or pg_get_constraintdef(oid) not ilike '%gps_accuracy <%'
          or pg_get_constraintdef(oid) not ilike '%location_consent_status%'
          or pg_get_constraintdef(oid) not ilike '%consented%'
          or pg_get_constraintdef(oid) not ilike '%gps_permission_status%'
          or pg_get_constraintdef(oid) not ilike '%granted%'
      )
    ) then
      raise exception 'Preflight stopped: existing visitor_analytics_gps_integrity_check has an unexpected definition; review it before retrying.';
    end if;
    if not exists (
      select 1 from pg_constraint
      where conrelid = table_oid and contype = 'p'
        and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
    ) then
      raise exception 'Preflight stopped: existing public.visitor_analytics must retain its primary key on id.';
    end if;
    if exists (
      select 1 from pg_constraint
      where conrelid = table_oid and conname = 'visitor_analytics_location_consent_status_check'
        and (
          contype <> 'c'
          or pg_get_constraintdef(oid) not ilike '%not_asked%'
          or pg_get_constraintdef(oid) not ilike '%declined%'
          or pg_get_constraintdef(oid) not ilike '%consented%'
          or pg_get_constraintdef(oid) not ilike '%revoked%'
        )
    ) then
      raise exception 'Preflight stopped: existing location consent constraint has an unexpected definition.';
    end if;
    if exists (
      select 1 from pg_constraint
      where conrelid = table_oid and conname = 'visitor_analytics_gps_permission_status_check'
        and (
          contype <> 'c'
          or pg_get_constraintdef(oid) not ilike '%not_requested%'
          or pg_get_constraintdef(oid) not ilike '%granted%'
          or pg_get_constraintdef(oid) not ilike '%denied%'
          or pg_get_constraintdef(oid) not ilike '%unavailable%'
          or pg_get_constraintdef(oid) not ilike '%error%'
          or pg_get_constraintdef(oid) not ilike '%revoked%'
        )
    ) then
      raise exception 'Preflight stopped: existing GPS permission constraint has an unexpected definition.';
    end if;

    select string_agg(format('%I.%I', table_class.relname, policy_row.polname), ', ')
    into unexpected_policies
    from pg_policy policy_row
    join pg_class table_class on table_class.oid = policy_row.polrelid
    join pg_namespace table_schema on table_schema.oid = table_class.relnamespace
    where table_schema.nspname = 'public'
      and table_class.relname in ('visitor_analytics', 'visitor_analytics_rate_limits', 'visitor_analytics_gps_challenges')
      and not (
        table_class.relname = 'visitor_analytics'
        and policy_row.polpermissive
        and cardinality(policy_row.polroles) = 1
        and policy_row.polroles[1] = (select oid from pg_roles where rolname = 'authenticated')
        and policy_row.polwithcheck is null
        and (
          (
            policy_row.polname = 'Admins can read visitor analytics'
            and policy_row.polcmd = 'r'
            and regexp_replace(lower(coalesce(pg_get_expr(policy_row.polqual, policy_row.polrelid), '')), '[[:space:]()]', '', 'g')
              in ('public.is_admin', 'selectpublic.is_adminasis_admin')
          )
          or (
            policy_row.polname = 'Admins can delete visitor analytics'
            and policy_row.polcmd = 'd'
            and regexp_replace(lower(coalesce(pg_get_expr(policy_row.polqual, policy_row.polrelid), '')), '[[:space:]()]', '', 'g')
              in ('public.is_admin', 'selectpublic.is_adminasis_admin')
          )
        )
      );
    if unexpected_policies is not null then
      raise exception 'Preflight stopped: unexpected analytics policies require manual review: %.', unexpected_policies;
    end if;

    if exists (
      select 1 from pg_index index_data
      where index_data.indrelid = table_oid
        and index_data.indisunique
        and index_data.indnkeyatts = 2
        and (
          select array_agg(attribute.attname order by key_column.ordinality)
          from unnest(index_data.indkey) with ordinality as key_column(attnum, ordinality)
          join pg_attribute attribute
            on attribute.attrelid = index_data.indrelid
            and attribute.attnum = key_column.attnum
          where key_column.ordinality <= index_data.indnkeyatts
        ) in (
          array['visitor_id', 'session_id']::name[],
          array['session_id', 'visitor_id']::name[]
        )
        and not exists (
          select 1 from pg_constraint constraint_row
          where constraint_row.conindid = index_data.indexrelid
            and constraint_row.contype = 'u'
        )
    ) then
      raise exception 'Preflight stopped: a standalone unique index on visitor_id and session_id conflicts with repeat visits. Review and remove it explicitly before retrying.';
    end if;

    for expected_index in
      select * from (values
        ('visitor_analytics_visit_id_idx', '(visit_id)', true),
        ('visitor_analytics_visited_at_idx', '(visited_at DESC)', false),
        ('visitor_analytics_visitor_id_idx', '(visitor_id)', false),
        ('visitor_analytics_device_type_idx', '(device_type)', false),
        ('visitor_analytics_gps_status_idx', '(gps_permission_status)', false)
      ) as expected(name, definition_fragment, is_unique)
    loop
      select relation.relkind, index_data.indrelid,
        case when relation.relkind = 'i' then pg_get_indexdef(relation.oid) end as definition,
        index_data.indisunique
      into existing_index
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      left join pg_index index_data on index_data.indexrelid = relation.oid
      where namespace.nspname = 'public' and relation.relname = expected_index.name;
      if found and (
        existing_index.relkind <> 'i'
        or existing_index.indrelid <> table_oid
        or existing_index.indisunique <> expected_index.is_unique
        or position(lower(expected_index.definition_fragment) in lower(existing_index.definition)) = 0
      ) then
        raise exception 'Preflight stopped: public.% conflicts with the expected analytics index. Review it manually.', expected_index.name;
      end if;
    end loop;
  end if;

  table_oid := to_regclass('public.visitor_analytics_rate_limits');
  if table_oid is not null then
    if not exists (select 1 from pg_class where oid = table_oid and relkind = 'r') then
      raise exception 'public.visitor_analytics_rate_limits exists but is not an ordinary table.';
    end if;
    select string_agg(required.column_name, ', ')
    into missing_columns
    from (values
      ('client_hash', 'text'::regtype), ('window_started_at', 'timestamp with time zone'::regtype),
      ('request_count', 'integer'::regtype)
    ) as required(column_name, expected_type)
    left join pg_attribute actual
      on actual.attrelid = table_oid and actual.attname = required.column_name and not actual.attisdropped
    where actual.attnum is null or actual.atttypid <> required.expected_type;
    if missing_columns is not null then
      raise exception 'Existing public.visitor_analytics_rate_limits has missing or incompatible columns: %. Review the schema before retrying.', missing_columns;
    end if;
    if exists (
      select 1 from pg_policy where polrelid = table_oid
    ) then
      raise exception 'Preflight stopped: unexpected policy exists on public.visitor_analytics_rate_limits. Review it before retrying.';
    end if;
    if exists (
      select 1 from pg_trigger where tgrelid = table_oid and not tgisinternal
    ) then
      raise exception 'Preflight stopped: unexpected trigger exists on public.visitor_analytics_rate_limits. Review it before retrying.';
    end if;
    if not exists (
      select 1 from pg_constraint
      where conrelid = table_oid and contype = 'p'
        and pg_get_constraintdef(oid) = 'PRIMARY KEY (client_hash)'
    ) then
      raise exception 'Existing public.visitor_analytics_rate_limits lacks its expected primary key; review the schema before retrying.';
    end if;
    execute $query$
      select count(*)
      from public.visitor_analytics_rate_limits
      where client_hash is null or char_length(client_hash) <> 64
        or window_started_at is null or request_count is null or request_count <= 0
    $query$ into invalid_rows;
    if invalid_rows > 0 then
      raise exception 'Preflight stopped: % rate-limit records contain NULL values required by the RPC. Review and manually remediate them before retrying; no records were changed.', invalid_rows;
    end if;
  end if;

  table_oid := to_regclass('public.visitor_analytics_gps_challenges');
  if table_oid is not null then
    if not exists (select 1 from pg_class where oid = table_oid and relkind = 'r') then
      raise exception 'public.visitor_analytics_gps_challenges exists but is not an ordinary table.';
    end if;
    execute 'select count(*) from public.visitor_analytics_gps_challenges' into table_rows;
    select string_agg(required.column_name, ', ')
    into missing_columns
    from (values ('challenge_hash'), ('visitor_id'), ('visit_id'), ('expires_at')) as required(column_name)
    left join pg_attribute actual
      on actual.attrelid = table_oid and actual.attname = required.column_name and not actual.attisdropped
    where actual.attnum is null;
    if missing_columns is not null then
      raise exception 'Existing public.visitor_analytics_gps_challenges is missing required columns: %. Review the schema manually.', missing_columns;
    end if;
    if not exists (
      select 1 from pg_attribute where attrelid = table_oid and attname = 'consent_version' and not attisdropped
    ) and table_rows > 0 then
      raise exception 'Existing GPS challenges contain % records but lack consent_version. Review or explicitly expire those challenges before retrying; no records were changed.', table_rows;
    end if;
    if exists (
      select 1 from pg_constraint
      where conrelid = table_oid and contype = 'p'
        and pg_get_constraintdef(oid) <> 'PRIMARY KEY (challenge_hash)'
    ) or not exists (
      select 1 from pg_constraint
      where conrelid = table_oid and contype = 'p'
        and pg_get_constraintdef(oid) = 'PRIMARY KEY (challenge_hash)'
    ) then
      raise exception 'Existing public.visitor_analytics_gps_challenges has an unexpected primary key; review it before retrying.';
    end if;
    select string_agg(required.column_name, ', ')
    into incompatible_columns
    from (values
      ('challenge_hash', 'text'::regtype), ('visitor_id', 'uuid'::regtype),
      ('visit_id', 'uuid'::regtype), ('consent_version', 'uuid'::regtype),
      ('expires_at', 'timestamp with time zone'::regtype)
    ) as required(column_name, expected_type)
    left join pg_attribute actual
      on actual.attrelid = table_oid and actual.attname = required.column_name and not actual.attisdropped
    where actual.attnum is not null and actual.atttypid <> required.expected_type;
    if incompatible_columns is not null then
      raise exception 'Existing public.visitor_analytics_gps_challenges has incompatible column types: %. Review the schema before retrying.', incompatible_columns;
    end if;
    if exists (select 1 from pg_policy where polrelid = table_oid) then
      raise exception 'Preflight stopped: unexpected policy exists on public.visitor_analytics_gps_challenges.';
    end if;
    if exists (select 1 from pg_trigger where tgrelid = table_oid and not tgisinternal) then
      raise exception 'Preflight stopped: unexpected trigger exists on public.visitor_analytics_gps_challenges.';
    end if;
    if exists (
      select 1 from pg_attribute
      where attrelid = table_oid and attname = 'consent_version' and not attisdropped
    ) then
      execute $query$
        select count(*)
        from public.visitor_analytics_gps_challenges
        where challenge_hash is null or visitor_id is null or visit_id is null
          or char_length(challenge_hash) <> 64 or consent_version is null or expires_at is null
      $query$
      into invalid_rows;
      if invalid_rows > 0 then
        raise exception 'Preflight stopped: % GPS challenge records contain NULL values required by the challenge flow. Review and explicitly expire or remediate them before retrying; no records were changed.', invalid_rows;
      end if;
    else
      execute $query$
        select count(*)
        from public.visitor_analytics_gps_challenges
        where challenge_hash is null or char_length(challenge_hash) <> 64
          or visitor_id is null or visit_id is null or expires_at is null
      $query$ into invalid_rows;
      if invalid_rows > 0 then
        raise exception 'Preflight stopped: % GPS challenge records contain NULL values required by the challenge flow. Review and explicitly expire or remediate them before retrying; no records were changed.', invalid_rows;
      end if;
    end if;
  end if;
end;
$$;

create table if not exists public.visitor_analytics (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null default gen_random_uuid(),
  visitor_id uuid not null,
  session_id uuid not null,
  first_visited_at timestamptz,
  visited_at timestamptz not null default now(),
  page_path text not null check (char_length(page_path) between 1 and 512 and left(page_path, 1) = '/'),
  referrer text check (referrer is null or char_length(referrer) <= 512),
  device_type text not null check (device_type in ('mobile', 'desktop', 'tablet', 'unknown')),
  device_brand text not null check (char_length(device_brand) between 1 and 80),
  device_model text not null check (char_length(device_model) between 1 and 120),
  operating_system text not null check (char_length(operating_system) between 1 and 80),
  os_version text not null check (char_length(os_version) <= 80),
  browser text not null check (char_length(browser) between 1 and 80),
  browser_version text not null check (char_length(browser_version) <= 80),
  screen_width integer check (screen_width between 0 and 20000),
  screen_height integer check (screen_height between 0 and 20000),
  device_pixel_ratio numeric(6, 2) check (device_pixel_ratio between 0 and 20),
  language text not null check (char_length(language) between 1 and 40),
  timezone text not null check (char_length(timezone) between 1 and 100),
  location_consent_status text not null default 'not_asked',
  location_consent_version uuid not null default gen_random_uuid(),
  gps_permission_status text not null default 'not_requested'
    check (gps_permission_status in ('not_requested', 'granted', 'denied', 'unavailable', 'error', 'revoked')),
  latitude double precision,
  longitude double precision,
  gps_accuracy numeric(12, 2),
  gps_collected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint visitor_analytics_gps_integrity_check check (
    (
      latitude is null
      and longitude is null
      and gps_accuracy is null
      and gps_collected_at is null
    )
    or (
      latitude is not null
      and longitude is not null
      and gps_accuracy is not null
      and gps_collected_at is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
      and gps_accuracy >= 0
      and gps_accuracy < 'Infinity'::numeric
      and gps_permission_status = 'granted'
      and location_consent_status = 'consented'
    )
  )
);

alter table public.visitor_analytics enable row level security;
revoke all on public.visitor_analytics from public, anon, authenticated, service_role;

alter table public.visitor_analytics
  add column if not exists visit_id uuid;
alter table public.visitor_analytics
  add column if not exists location_consent_status text;
alter table public.visitor_analytics
  add column if not exists location_consent_version uuid;

do $$
declare
  invalid_columns text;
  unexpected_triggers text;
  duplicate_visit_id_groups bigint;
  invalid_gps_rows bigint;
  existing_index record;
  expected_index record;
begin
  select string_agg(required.column_name, ', ')
  into invalid_columns
  from (values
    ('id', 'uuid'::regtype), ('visit_id', 'uuid'::regtype),
    ('visitor_id', 'uuid'::regtype), ('session_id', 'uuid'::regtype),
    ('first_visited_at', 'timestamp with time zone'::regtype),
    ('visited_at', 'timestamp with time zone'::regtype),
    ('page_path', 'text'::regtype), ('referrer', 'text'::regtype),
    ('device_type', 'text'::regtype), ('device_brand', 'text'::regtype),
    ('device_model', 'text'::regtype), ('operating_system', 'text'::regtype),
    ('os_version', 'text'::regtype), ('browser', 'text'::regtype),
    ('browser_version', 'text'::regtype), ('screen_width', 'integer'::regtype),
    ('screen_height', 'integer'::regtype), ('device_pixel_ratio', 'numeric'::regtype),
    ('language', 'text'::regtype), ('timezone', 'text'::regtype),
    ('location_consent_status', 'text'::regtype),
    ('location_consent_version', 'uuid'::regtype), ('gps_permission_status', 'text'::regtype),
    ('latitude', 'double precision'::regtype), ('longitude', 'double precision'::regtype),
    ('gps_accuracy', 'numeric'::regtype), ('gps_collected_at', 'timestamp with time zone'::regtype),
    ('created_at', 'timestamp with time zone'::regtype)
  ) as required(column_name, expected_type)
  left join pg_attribute actual
    on actual.attrelid = 'public.visitor_analytics'::regclass
    and actual.attname = required.column_name
    and not actual.attisdropped
  where actual.attnum is null or actual.atttypid <> required.expected_type;
  if invalid_columns is not null then
    raise exception 'public.visitor_analytics has missing or incompatible columns: %. Review the existing schema before retrying.', invalid_columns;
  end if;
  if exists (
    select 1
    from public.visitor_analytics
    where visitor_id is null
      or session_id is null
      or visited_at is null
      or page_path is null
      or device_type is null
      or device_brand is null
      or device_model is null
      or operating_system is null
      or os_version is null
      or browser is null
      or browser_version is null
      or language is null
      or timezone is null
      or location_consent_status is null
      or gps_permission_status is null
      or created_at is null
  ) then
    raise exception 'public.visitor_analytics has NULL values in required columns. Review and repair those rows before retrying.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) then
    raise exception 'public.visitor_analytics must retain its primary key on id.';
  end if;

  select string_agg(trigger_name, ', ')
  into unexpected_triggers
  from (
    select trigger_row.tgname as trigger_name
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.visitor_analytics'::regclass
      and not trigger_row.tgisinternal
  ) triggers;
  if unexpected_triggers is not null then
    raise exception 'Existing non-internal triggers on public.visitor_analytics require manual review before migration: %', unexpected_triggers;
  end if;

  if exists (
    select 1
    from pg_index index_data
    where index_data.indrelid = 'public.visitor_analytics'::regclass
      and index_data.indisunique
      and index_data.indnkeyatts = 2
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_data.indkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_data.indrelid
          and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_data.indnkeyatts
      ) in (
        array['visitor_id', 'session_id']::name[],
        array['session_id', 'visitor_id']::name[]
      )
      and not exists (
        select 1 from pg_constraint constraint_row
        where constraint_row.conindid = index_data.indexrelid
          and constraint_row.contype = 'u'
          and pg_get_constraintdef(constraint_row.oid) in (
            'UNIQUE (visitor_id, session_id)',
            'UNIQUE (session_id, visitor_id)'
          )
      )
  ) then
    raise exception 'A standalone unique index on (visitor_id, session_id) conflicts with repeat-visit recording. Review and remove it explicitly before retrying.';
  end if;

  select count(*) into duplicate_visit_id_groups
  from (
    select visit_id
    from public.visitor_analytics
    where visit_id is not null
    group by visit_id
    having count(*) > 1
  ) duplicate_ids;
  if duplicate_visit_id_groups > 0 then
    raise exception 'Migration stopped: % duplicate visit_id groups exist. Resolve them without deleting visit records, then retry.', duplicate_visit_id_groups;
  end if;

  select count(*) into invalid_gps_rows
  from public.visitor_analytics
  where not (
    (
      latitude is null and longitude is null
      and gps_accuracy is null and gps_collected_at is null
    )
    or (
      latitude is not null and longitude is not null
      and gps_accuracy is not null and gps_collected_at is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
      and gps_accuracy >= 0
      and gps_accuracy < 'Infinity'::numeric
      and gps_permission_status = 'granted'
      and location_consent_status = 'consented'
    )
  );
  if invalid_gps_rows > 0 then
    raise exception 'Migration stopped: % rows contain partial or inconsistent GPS data. Review and explicitly clear/revoke only those GPS fields before retrying; no visitor records were deleted.', invalid_gps_rows;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and conname = 'visitor_analytics_location_consent_status_check'
      and (
        contype <> 'c'
        or pg_get_constraintdef(oid) not ilike '%not_asked%'
        or pg_get_constraintdef(oid) not ilike '%declined%'
        or pg_get_constraintdef(oid) not ilike '%consented%'
        or pg_get_constraintdef(oid) not ilike '%revoked%'
      )
  ) then
    raise exception 'Existing visitor_analytics_location_consent_status_check has an unexpected definition.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and conname = 'visitor_analytics_location_consent_status_check'
  ) then
    alter table public.visitor_analytics
      add constraint visitor_analytics_location_consent_status_check
      check (location_consent_status in ('not_asked', 'declined', 'consented', 'revoked'));
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and conname = 'visitor_analytics_gps_permission_status_check'
      and (
        contype <> 'c'
        or pg_get_constraintdef(oid) not ilike '%not_requested%'
        or pg_get_constraintdef(oid) not ilike '%granted%'
        or pg_get_constraintdef(oid) not ilike '%denied%'
        or pg_get_constraintdef(oid) not ilike '%unavailable%'
        or pg_get_constraintdef(oid) not ilike '%error%'
        or pg_get_constraintdef(oid) not ilike '%revoked%'
      )
  ) then
    raise exception 'Existing visitor_analytics_gps_permission_status_check has an unexpected definition.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and conname = 'visitor_analytics_gps_permission_status_check'
  ) then
    alter table public.visitor_analytics
      add constraint visitor_analytics_gps_permission_status_check
      check (gps_permission_status in ('not_requested', 'granted', 'denied', 'unavailable', 'error', 'revoked'));
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and conname = 'visitor_analytics_gps_integrity_check'
      and (
        contype <> 'c'
        or pg_get_constraintdef(oid) not ilike '%latitude IS NULL%'
        or pg_get_constraintdef(oid) not ilike '%longitude IS NULL%'
        or pg_get_constraintdef(oid) not ilike '%gps_accuracy IS NULL%'
        or pg_get_constraintdef(oid) not ilike '%gps_collected_at IS NULL%'
        or pg_get_constraintdef(oid) not ilike '%latitude IS NOT NULL%'
        or pg_get_constraintdef(oid) not ilike '%longitude IS NOT NULL%'
        or pg_get_constraintdef(oid) not ilike '%gps_accuracy IS NOT NULL%'
        or pg_get_constraintdef(oid) not ilike '%gps_collected_at IS NOT NULL%'
        or pg_get_constraintdef(oid) not ilike '%latitude >=%'
        or pg_get_constraintdef(oid) not ilike '%latitude <=%'
        or pg_get_constraintdef(oid) not ilike '%longitude >=%'
        or pg_get_constraintdef(oid) not ilike '%longitude <=%'
        or pg_get_constraintdef(oid) not ilike '%gps_accuracy >=%'
        or pg_get_constraintdef(oid) not ilike '%gps_accuracy <%'
        or pg_get_constraintdef(oid) not ilike '%location_consent_status%'
        or pg_get_constraintdef(oid) not ilike '%consented%'
        or pg_get_constraintdef(oid) not ilike '%gps_permission_status%'
        or pg_get_constraintdef(oid) not ilike '%granted%'
      )
  ) then
    raise exception 'Existing visitor_analytics_gps_integrity_check has an unexpected definition.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and conname = 'visitor_analytics_gps_integrity_check'
  ) then
    alter table public.visitor_analytics
      add constraint visitor_analytics_gps_integrity_check check (
        (
          latitude is null and longitude is null
          and gps_accuracy is null and gps_collected_at is null
        )
        or (
          latitude is not null and longitude is not null
          and gps_accuracy is not null and gps_collected_at is not null
          and latitude between -90 and 90
          and longitude between -180 and 180
          and gps_accuracy >= 0
          and gps_accuracy < 'Infinity'::numeric
          and gps_permission_status = 'granted'
          and location_consent_status = 'consented'
        )
      );
  end if;

  for expected_index in
    select * from (values
      ('visitor_analytics_visit_id_idx', 'visitor_analytics', '(visit_id)', true),
      ('visitor_analytics_visited_at_idx', 'visitor_analytics', '(visited_at DESC)', false),
      ('visitor_analytics_visitor_id_idx', 'visitor_analytics', '(visitor_id)', false),
      ('visitor_analytics_device_type_idx', 'visitor_analytics', '(device_type)', false),
      ('visitor_analytics_gps_status_idx', 'visitor_analytics', '(gps_permission_status)', false)
    ) as expected(name, table_name, definition_fragment, is_unique)
  loop
    select relation.relkind, index_data.indrelid,
      case when relation.relkind = 'i' then pg_get_indexdef(relation.oid) end as definition,
      index_data.indisunique
    into existing_index
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    left join pg_index index_data on index_data.indexrelid = relation.oid
    where namespace.nspname = 'public'
      and relation.relname = expected_index.name;
    if found then
      if existing_index.relkind <> 'i'
        or existing_index.indrelid <> 'public.visitor_analytics'::regclass
        or existing_index.indisunique <> expected_index.is_unique
        or position(lower(expected_index.definition_fragment) in lower(existing_index.definition)) = 0 then
        raise exception 'Existing public.% conflicts with the expected visitor analytics index; review it manually.', expected_index.name;
      end if;
    end if;
  end loop;
end;
$$;

alter table public.visitor_analytics
  alter column location_consent_version set default gen_random_uuid();
alter table public.visitor_analytics
  alter column location_consent_status set default 'not_asked';
alter table public.visitor_analytics
  alter column location_consent_version set not null;
alter table public.visitor_analytics
  alter column location_consent_status set not null;
alter table public.visitor_analytics
  alter column gps_permission_status set not null;
alter table public.visitor_analytics alter column visit_id set default gen_random_uuid();
alter table public.visitor_analytics alter column visit_id set not null;

do $$
declare
  unique_constraint record;
begin
  for unique_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.visitor_analytics'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) in (
        'UNIQUE (visitor_id, session_id)',
        'UNIQUE (session_id, visitor_id)'
      )
  loop
    execute format('alter table public.visitor_analytics drop constraint %I', unique_constraint.conname);
  end loop;
end;
$$;

create unique index if not exists visitor_analytics_visit_id_idx
  on public.visitor_analytics (visit_id);
create index if not exists visitor_analytics_visited_at_idx
  on public.visitor_analytics (visited_at desc);
create index if not exists visitor_analytics_visitor_id_idx
  on public.visitor_analytics (visitor_id);
create index if not exists visitor_analytics_device_type_idx
  on public.visitor_analytics (device_type);
create index if not exists visitor_analytics_gps_status_idx
  on public.visitor_analytics (gps_permission_status);

do $$
declare
  unexpected_policies text;
begin
  select string_agg(format('%I.%I', table_class.relname, pol.polname), ', ')
  into unexpected_policies
  from pg_policy pol
  join pg_class table_class on table_class.oid = pol.polrelid
  join pg_namespace table_schema on table_schema.oid = table_class.relnamespace
  where table_schema.nspname = 'public'
    and table_class.relname in (
      'visitor_analytics',
      'visitor_analytics_rate_limits',
      'visitor_analytics_gps_challenges'
    )
    and not (
      table_class.relname = 'visitor_analytics'
      and pol.polpermissive
      and cardinality(pol.polroles) = 1
      and pol.polroles[1] = (select oid from pg_roles where rolname = 'authenticated')
      and pol.polwithcheck is null
      and (
        (
          pol.polname = 'Admins can read visitor analytics'
          and pol.polcmd = 'r'
          and regexp_replace(lower(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')), '[[:space:]()]', '', 'g')
            in ('public.is_admin', 'selectpublic.is_adminasis_admin')
        )
        or (
          pol.polname = 'Admins can delete visitor analytics'
          and pol.polcmd = 'd'
          and regexp_replace(lower(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')), '[[:space:]()]', '', 'g')
            in ('public.is_admin', 'selectpublic.is_adminasis_admin')
        )
      )
    );

  if unexpected_policies is not null then
    raise exception 'Unexpected permissive visitor analytics policies require manual review: %',
      unexpected_policies;
  end if;
end;
$$;

drop policy if exists "Admins can read visitor analytics" on public.visitor_analytics;
create policy "Admins can read visitor analytics"
  on public.visitor_analytics for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Admins can delete visitor analytics" on public.visitor_analytics;
create policy "Admins can delete visitor analytics"
  on public.visitor_analytics for delete to authenticated
  using ((select public.is_admin()));

grant select, insert, update, delete on public.visitor_analytics to service_role;
grant select, delete on public.visitor_analytics to authenticated;

create table if not exists public.visitor_analytics_rate_limits (
  client_hash text primary key check (char_length(client_hash) = 64),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0)
);

alter table public.visitor_analytics_rate_limits enable row level security;
revoke all on public.visitor_analytics_rate_limits from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.visitor_analytics_rate_limits to service_role;

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

  delete from public.visitor_analytics_gps_challenges
  where expires_at <= now();

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

create table if not exists public.visitor_analytics_gps_challenges (
  challenge_hash text primary key check (char_length(challenge_hash) = 64),
  visitor_id uuid not null,
  visit_id uuid not null,
  consent_version uuid not null default gen_random_uuid(),
  expires_at timestamptz not null
);

alter table public.visitor_analytics_gps_challenges
  add column if not exists consent_version uuid;

alter table public.visitor_analytics_gps_challenges enable row level security;
revoke all on public.visitor_analytics_gps_challenges from public, anon, authenticated, service_role;

do $$
declare
  invalid_columns text;
  unexpected_triggers text;
begin
  select string_agg(required.column_name, ', ')
  into invalid_columns
  from (values
    ('client_hash', 'text'::regtype),
    ('window_started_at', 'timestamp with time zone'::regtype),
    ('request_count', 'integer'::regtype)
  ) as required(column_name, expected_type)
  left join pg_attribute actual
    on actual.attrelid = 'public.visitor_analytics_rate_limits'::regclass
    and actual.attname = required.column_name
    and not actual.attisdropped
  where actual.attnum is null or actual.atttypid <> required.expected_type;
  if invalid_columns is not null then
    raise exception 'public.visitor_analytics_rate_limits has missing or incompatible columns: %.', invalid_columns;
  end if;

  select string_agg(required.column_name, ', ')
  into invalid_columns
  from (values
    ('challenge_hash', 'text'::regtype), ('visitor_id', 'uuid'::regtype),
    ('visit_id', 'uuid'::regtype), ('consent_version', 'uuid'::regtype),
    ('expires_at', 'timestamp with time zone'::regtype)
  ) as required(column_name, expected_type)
  left join pg_attribute actual
    on actual.attrelid = 'public.visitor_analytics_gps_challenges'::regclass
    and actual.attname = required.column_name
    and not actual.attisdropped
  where actual.attnum is null or actual.atttypid <> required.expected_type;
  if invalid_columns is not null then
    raise exception 'public.visitor_analytics_gps_challenges has missing or incompatible columns: %.', invalid_columns;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics_rate_limits'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (client_hash)'
  ) then
    raise exception 'public.visitor_analytics_rate_limits must retain its primary key on client_hash.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitor_analytics_gps_challenges'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (challenge_hash)'
  ) then
    raise exception 'public.visitor_analytics_gps_challenges must retain its primary key on challenge_hash.';
  end if;

  select string_agg(format('%I.%I', table_class.relname, trigger_row.tgname), ', ')
  into unexpected_triggers
  from pg_trigger trigger_row
  join pg_class table_class on table_class.oid = trigger_row.tgrelid
  join pg_namespace table_schema on table_schema.oid = table_class.relnamespace
  where table_schema.nspname = 'public'
    and table_class.relname in ('visitor_analytics_rate_limits', 'visitor_analytics_gps_challenges')
    and not trigger_row.tgisinternal;
  if unexpected_triggers is not null then
    raise exception 'Existing non-internal triggers on visitor analytics helper tables require manual review: %', unexpected_triggers;
  end if;
end;
$$;

alter table public.visitor_analytics_gps_challenges
  alter column consent_version set default gen_random_uuid();
alter table public.visitor_analytics_gps_challenges
  alter column consent_version set not null;

grant select, insert, delete on public.visitor_analytics_gps_challenges to service_role;

create or replace function public.consume_visitor_analytics_gps_challenge(
  p_challenge_hash text,
  p_visitor_id uuid,
  p_visit_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  consumed boolean := false;
begin
  delete from public.visitor_analytics_gps_challenges
  where expires_at <= now();

  if p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$'
    or p_visitor_id is null or p_visit_id is null then
    return false;
  end if;

  delete from public.visitor_analytics_gps_challenges
  where challenge_hash = p_challenge_hash
    and visitor_id = p_visitor_id
    and visit_id = p_visit_id
    and consent_version = (
      select location_consent_version
      from public.visitor_analytics
      where visitor_id = p_visitor_id
        and visit_id = p_visit_id
        and location_consent_status = 'consented'
        and gps_permission_status <> 'revoked'
        and latitude is null
        and longitude is null
        and gps_accuracy is null
        and gps_collected_at is null
    )
    and expires_at > now()
  returning true into consumed;

  return coalesce(consumed, false);
end;
$$;

revoke all on function public.consume_visitor_analytics_gps_challenge(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_visitor_analytics_gps_challenge(text, uuid, uuid) to service_role;

create or replace function public.get_visitor_analytics_summary(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  total_visits bigint,
  unique_visitors bigint,
  gps_shared_visitors bigint,
  visitors_without_gps bigint,
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
    count(distinct visitor_id) filter (where gps_permission_status = 'granted' and latitude is not null)::bigint,
    count(distinct visit.visitor_id) filter (
      where not exists (
        select 1
        from public.visitor_analytics shared
        where shared.visitor_id = visit.visitor_id
          and shared.gps_permission_status = 'granted'
          and shared.latitude is not null
          and (p_from is null or shared.visited_at >= p_from)
          and (p_to is null or shared.visited_at < p_to)
      )
    )::bigint,
    count(distinct visitor_id) filter (where device_type = 'mobile')::bigint,
    count(distinct visitor_id) filter (where device_type = 'desktop')::bigint,
    count(distinct visitor_id) filter (where device_type = 'tablet')::bigint
  from public.visitor_analytics visit
  where (p_from is null or visit.visited_at >= p_from)
    and (p_to is null or visit.visited_at < p_to);
end;
$$;

revoke all on function public.get_visitor_analytics_summary(timestamptz, timestamptz) from public, anon;
revoke all on function public.get_visitor_analytics_summary(timestamptz, timestamptz) from authenticated;
grant execute on function public.get_visitor_analytics_summary(timestamptz, timestamptz) to authenticated;

create or replace function public.purge_visitor_analytics_older_than(p_older_than_days integer)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  removed_count bigint;
begin
  if not (select public.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_older_than_days is null or p_older_than_days < 1 or p_older_than_days > 3650 then
    raise exception 'Retention age must be between 1 and 3650 days' using errcode = '22023';
  end if;

  delete from public.visitor_analytics
  where visited_at < now() - make_interval(days => p_older_than_days);
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.purge_visitor_analytics_older_than(integer) from public, anon;
revoke all on function public.purge_visitor_analytics_older_than(integer) from authenticated;
grant execute on function public.purge_visitor_analytics_older_than(integer) to authenticated;
