begin;

select plan(22);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'contact-test-admin@example.test', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'contact-test-user@example.test', '', now(), now(), now());

insert into public.admin_users (user_id)
values ('00000000-0000-4000-8000-000000000001');

insert into public.inquiries (
  id,
  name,
  email,
  service,
  message
)
values (
  '00000000-0000-4000-8000-000000000003',
  'Contact Test',
  'contact-test-inquiry@example.test',
  'Web Development',
  'This is a test inquiry for RLS verification.'
);

select ok(
  not has_table_privilege('anon', 'public.inquiries', 'INSERT')
  and not exists (
    select 1
    from unnest(array['name', 'email', 'phone', 'service', 'message']) as column_name
    where has_column_privilege('anon', 'public.inquiries', column_name, 'INSERT')
  ),
  'anonymous clients cannot insert inquiries directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.inquiries', 'INSERT')
  and not exists (
    select 1
    from unnest(array['name', 'email', 'phone', 'service', 'message']) as column_name
    where has_column_privilege('authenticated', 'public.inquiries', column_name, 'INSERT')
  ),
  'authenticated clients cannot bypass contact-submit'
);

select ok(
  not exists (
    select 1
    from pg_policy policy_row
    where policy_row.polrelid = 'public.inquiries'::regclass
      and policy_row.polcmd in ('a', '*')
      and (
        0 = any(policy_row.polroles)
        or (select oid from pg_roles where rolname = 'anon') = any(policy_row.polroles)
        or (select oid from pg_roles where rolname = 'authenticated') = any(policy_row.polroles)
      )
  ),
  'inquiries has no public or authenticated insert policy'
);

select ok(
  has_column_privilege('service_role', 'public.inquiries', 'name', 'INSERT')
  and has_column_privilege('service_role', 'public.inquiries', 'email', 'INSERT')
  and has_column_privilege('service_role', 'public.inquiries', 'phone', 'INSERT')
  and has_column_privilege('service_role', 'public.inquiries', 'service', 'INSERT')
  and has_column_privilege('service_role', 'public.inquiries', 'message', 'INSERT')
  and not has_table_privilege('service_role', 'public.inquiries', 'SELECT')
  and not has_table_privilege('service_role', 'public.inquiries', 'UPDATE')
  and not has_table_privilege('service_role', 'public.inquiries', 'DELETE'),
  'service role retains only the inquiry insert columns needed by the function'
);

select ok(
  not has_table_privilege('service_role', 'public.contact_submission_rate_limits', 'SELECT')
  and not has_table_privilege('service_role', 'public.contact_submission_rate_limits', 'INSERT')
  and not has_table_privilege('service_role', 'public.contact_submission_rate_limits', 'UPDATE')
  and not has_table_privilege('service_role', 'public.contact_submission_rate_limits', 'DELETE'),
  'rate-limit buckets cannot be written directly by the service role'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.consume_contact_submission_rate_limit(text, text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.consume_contact_submission_rate_limit(text, text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.consume_contact_submission_rate_limit(text, text)',
    'EXECUTE'
  ),
  'only the service role can consume contact rate-limit buckets'
);

set local role anon;
select throws_ok(
  $$insert into public.inquiries (name, email, service, message)
    values ('Public User', 'public@example.test', 'Web Development', 'This direct insert must be denied.')$$,
  '42501',
  'permission denied for table inquiries',
  'anonymous inquiry insert is denied by database privileges'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.inquiries where id = '00000000-0000-4000-8000-000000000003'),
  0,
  'authenticated non-admin cannot read inquiries'
);
update public.inquiries
set status = 'read'
where id = '00000000-0000-4000-8000-000000000003';
delete from public.inquiries
where id = '00000000-0000-4000-8000-000000000003';
reset role;
select is(
  (select status from public.inquiries where id = '00000000-0000-4000-8000-000000000003'),
  'new',
  'authenticated non-admin cannot update or delete inquiries'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.inquiries where id = '00000000-0000-4000-8000-000000000003'),
  1,
  'authorized admin can read inquiries'
);
update public.inquiries
set status = 'read'
where id = '00000000-0000-4000-8000-000000000003';
reset role;
select is(
  (select status from public.inquiries where id = '00000000-0000-4000-8000-000000000003'),
  'read',
  'authorized admin can update inquiry status'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
delete from public.inquiries
where id = '00000000-0000-4000-8000-000000000003';
reset role;
select is(
  (select count(*)::integer from public.inquiries where id = '00000000-0000-4000-8000-000000000003'),
  0,
  'authorized admin can delete inquiries'
);

select lives_ok(
  $test$
    do $$
    declare
      attempt integer;
      result text;
      stable_ip_hash constant text := repeat('a', 64);
    begin
      for attempt in 1..10 loop
        result := public.consume_contact_submission_rate_limit(
          stable_ip_hash,
          lpad(to_hex(attempt), 64, '0')
        );
        if result <> 'allowed' then
          raise exception 'Trusted-IP bucket rejected an allowed attempt';
        end if;
      end loop;

      result := public.consume_contact_submission_rate_limit(
        stable_ip_hash,
        repeat('b', 64)
      );
      if result <> 'limited' then
        raise exception 'Changing email bypassed the trusted-IP rate limit';
      end if;
    end
    $$;
  $test$,
  'trusted-IP limiting applies across changing email identifiers'
);

select is(
  (select count(*)::integer
   from public.contact_submission_rate_limits
   where identifier_type = 'email'
     and identifier_hash = repeat('b', 64)),
  0,
  'denied requests with new emails do not create email buckets'
);

select is(
  (select count(*)::integer
   from public.contact_submission_rate_limits
   where identifier_type = 'email'
     and identifier_hash <> repeat('b', 64)),
  10,
  'only allowed IP attempts create distinct email buckets'
);

update public.contact_submission_rate_limits
set window_started_at = now() - interval '2 hours',
    last_seen_at = now()
where identifier_hash = repeat('a', 64)
   or identifier_hash = lpad(to_hex(1), 64, '0');
select is(
  public.consume_contact_submission_rate_limit(
    repeat('a', 64),
    lpad(to_hex(1), 64, '0')
  ),
  'allowed',
  'expired hourly counters reset while active buckets remain usable'
);

insert into public.contact_submission_rate_limits (
  identifier_type,
  identifier_hash,
  window_started_at,
  request_count,
  last_seen_at
)
select
  'email',
  'f' || lpad(to_hex(sequence_number), 63, '0'),
  now(),
  1,
  now()
from generate_series(1, 9989) as sequence_number;

select is(
  (select count(*)::integer from public.contact_submission_rate_limits),
  10000,
  'the rate-limit table is capped at 10000 buckets'
);

select is(
  public.consume_contact_submission_rate_limit(repeat('c', 64), repeat('d', 64)),
  'capacity',
  'new rate-limit identities are rejected when bucket storage is full'
);

select is(
  (select count(*)::integer
   from public.contact_submission_rate_limits
   where identifier_hash in (repeat('c', 64), repeat('d', 64))),
  0,
  'capacity rejection does not persist new rate-limit identifiers'
);

update public.contact_submission_rate_limits
set last_seen_at = now() - interval '2 days';
select lives_ok(
  'select public.purge_expired_backend_data()',
  'retention cleanup removes expired rate-limit rows'
);
select is(
  (select count(*)::integer from public.contact_submission_rate_limits),
  0,
  'expired rate-limit rows are deleted'
);

select throws_ok(
  $$select public.consume_contact_submission_rate_limit('invalid', repeat('e', 64))$$,
  '22023',
  'Invalid contact rate-limit identifiers',
  'invalid rate-limit hashes fail with a validation error'
);

select * from finish();
rollback;
