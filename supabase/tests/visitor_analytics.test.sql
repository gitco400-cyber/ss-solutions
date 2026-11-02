begin;

select plan(16);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'analytics-admin@example.test', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'analytics-user@example.test', '', now(), now(), now());

insert into public.admin_users (user_id)
values ('00000000-0000-4000-8000-000000000011');

insert into public.visitor_analytics_consents (visitor_id)
values
  ('00000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000000022');

insert into public.visitor_analytics (
  visit_id, visitor_id, session_id, page_path, device_type, operating_system,
  browser, browser_version, screen_category, device_model
)
values
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000021',
   '00000000-0000-4000-8000-000000000041', '/services', 'Desktop', 'Windows 11',
   'Google Chrome', '123.0.0.0', 'Full HD', 'Unknown'),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000022',
   '00000000-0000-4000-8000-000000000042', '/projects', 'Mobile', 'iOS',
   'Safari', '17.0', 'Mobile', 'iPhone');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.visitor_analytics'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.visitor_analytics_consents'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.visitor_analytics_rate_limits'::regclass),
  'RLS is enabled on visit, consent, and rate-limit tables'
);

select ok(
  not has_table_privilege('anon', 'public.visitor_analytics', 'SELECT')
  and not has_table_privilege('anon', 'public.visitor_analytics', 'INSERT')
  and not has_table_privilege('anon', 'public.visitor_analytics_consents', 'SELECT')
  and not has_table_privilege('anon', 'public.visitor_analytics_rate_limits', 'SELECT'),
  'anonymous users cannot read or write analytics or private identifiers'
);

select ok(
  has_table_privilege('authenticated', 'public.visitor_analytics', 'SELECT')
  and not has_table_privilege('authenticated', 'public.visitor_analytics', 'INSERT')
  and not has_table_privilege('authenticated', 'public.visitor_analytics', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.visitor_analytics', 'DELETE'),
  'authenticated clients have read-only analytics table privileges'
);

select ok(
  not has_table_privilege('service_role', 'public.visitor_analytics_consents', 'SELECT')
  and not has_table_privilege('service_role', 'public.visitor_analytics_rate_limits', 'SELECT')
  and not has_table_privilege('service_role', 'public.visitor_analytics_rate_limits', 'INSERT'),
  'service role cannot directly read consent or edit rate-limit buckets'
);

select ok(
  has_function_privilege('service_role', 'public.record_visitor_analytics_consent(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_visitor_analytics_consent(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_visitor_analytics_consent(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.consume_visitor_analytics_rate_limit(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.consume_visitor_analytics_rate_limit(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_visitor_analytics_rate_limit(text)', 'EXECUTE'),
  'only the service role can update consent or consume rate-limit buckets'
);

select ok(
  has_function_privilege('authenticated', 'public.get_visitor_analytics_summary()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_visitor_analytics_summary()', 'EXECUTE'),
  'only authenticated users can call the summary RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', true);
select is(
  (select count(*)::integer from public.visitor_analytics),
  0,
  'authenticated non-admin cannot read visitor records'
);
select throws_ok(
  $$select public.get_visitor_analytics_summary()$$,
  '42501',
  'Administrator access required',
  'authenticated non-admin cannot access analytics summaries'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
select is(
  (select count(*)::integer from public.visitor_analytics),
  2,
  'authorized admin can read visitor records'
);
select is(
  (select public.get_visitor_analytics_summary()->>'total_visits'),
  '2',
  'authorized admin summary includes recorded visits'
);
reset role;

select throws_ok(
  $$insert into public.visitor_analytics (
      visit_id, visitor_id, session_id, page_path, device_type, operating_system,
      browser, screen_category, device_model
    ) values (
      '00000000-0000-4000-8000-000000000051',
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000052',
      '/', 'Desktop', 'Unknown', 'Unknown', '1920x1080', 'Unknown'
    )$$,
  '23514',
  null,
  'database rejects detailed screen resolutions outside the coarse categories'
);

insert into public.visitor_analytics_consents (visitor_id, consented_at, last_confirmed_at)
values ('00000000-0000-4000-8000-000000000061', now() - interval '91 days', now() - interval '91 days');
insert into public.visitor_analytics (
  visit_id, visitor_id, session_id, page_path, device_type, operating_system,
  browser, screen_category, device_model, visited_at
)
values (
  '00000000-0000-4000-8000-000000000062',
  '00000000-0000-4000-8000-000000000061',
  '00000000-0000-4000-8000-000000000063',
  '/', 'Unknown', 'Unknown', 'Unknown', 'Other', 'Unknown', now() - interval '91 days'
);
insert into public.visitor_analytics_rate_limits (ip_hash, window_started_at, request_count, last_seen_at)
values (repeat('f', 64), now() - interval '2 days', 1, now() - interval '2 days');
select public.purge_expired_backend_data();
select is(
  (select count(*)::integer from public.visitor_analytics where visit_id = '00000000-0000-4000-8000-000000000062'),
  0,
  '90-day cleanup removes expired visits'
);
select is(
  (select count(*)::integer from public.visitor_analytics_consents where visitor_id = '00000000-0000-4000-8000-000000000061'),
  0,
  '90-day cleanup removes stale consent records'
);
select is(
  (select count(*)::integer from public.visitor_analytics_rate_limits where ip_hash = repeat('f', 64)),
  0,
  'rate-limit cleanup removes buckets idle for more than one day'
);

select public.revoke_visitor_analytics_consent('00000000-0000-4000-8000-000000000021');
select is(
  (select count(*)::integer from public.visitor_analytics where visitor_id = '00000000-0000-4000-8000-000000000021'),
  0,
  'revoking consent deletes the visitor analytics records'
);

select ok(
  exists (select 1 from cron.job where jobname = 'ss-solutions-retention'),
  'scheduled retention cleanup is configured'
);

select * from finish();
rollback;
