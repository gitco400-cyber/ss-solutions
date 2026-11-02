begin;

drop trigger if exists limit_contact_submissions on public.inquiries;
revoke all on function public.limit_contact_submissions() from public, anon, authenticated, service_role;
drop function if exists public.limit_contact_submissions();

drop policy if exists "Public can submit new inquiries" on public.inquiries;

do $$
declare
  insert_policy record;
begin
  for insert_policy in
    select policy_row.polname
    from pg_policy policy_row
    where policy_row.polrelid = 'public.inquiries'::regclass
      and policy_row.polcmd in ('a', '*')
      and (
        0 = any(policy_row.polroles)
        or (select oid from pg_roles where rolname = 'anon') = any(policy_row.polroles)
        or (select oid from pg_roles where rolname = 'authenticated') = any(policy_row.polroles)
      )
  loop
    execute format('drop policy %I on public.inquiries', insert_policy.polname);
  end loop;
end;
$$;

revoke all on table public.inquiries from public, anon, authenticated, service_role;
revoke insert (name, email, phone, service, message) on public.inquiries from anon, authenticated;
grant select, delete on public.inquiries to authenticated;
grant update (status) on public.inquiries to authenticated;
grant insert (name, email, phone, service, message) on public.inquiries to service_role;

create table public.contact_submission_rate_limits (
  identifier_type text not null check (identifier_type in ('ip', 'email')),
  identifier_hash text not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  primary key (identifier_type, identifier_hash)
);

create index contact_submission_rate_limits_window_idx
  on public.contact_submission_rate_limits (window_started_at);

alter table public.contact_submission_rate_limits enable row level security;
revoke all on table public.contact_submission_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.contact_submission_rate_limits to service_role;

create or replace function public.consume_contact_submission_rate_limit(
  p_ip_hash text,
  p_email_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  ip_count integer;
  email_count integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid contact rate-limit identifiers'
      using errcode = '22023';
  end if;

  delete from public.contact_submission_rate_limits
  where window_started_at < now() - interval '1 day';

  insert into public.contact_submission_rate_limits (
    identifier_type,
    identifier_hash
  )
  values ('ip', p_ip_hash)
  on conflict (identifier_type, identifier_hash) do update
  set
    request_count = case
      when public.contact_submission_rate_limits.window_started_at < now() - interval '1 hour' then 1
      else public.contact_submission_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.contact_submission_rate_limits.window_started_at < now() - interval '1 hour' then now()
      else public.contact_submission_rate_limits.window_started_at
    end
  returning request_count into ip_count;

  insert into public.contact_submission_rate_limits (
    identifier_type,
    identifier_hash
  )
  values ('email', p_email_hash)
  on conflict (identifier_type, identifier_hash) do update
  set
    request_count = case
      when public.contact_submission_rate_limits.window_started_at < now() - interval '1 hour' then 1
      else public.contact_submission_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.contact_submission_rate_limits.window_started_at < now() - interval '1 hour' then now()
      else public.contact_submission_rate_limits.window_started_at
    end
  returning request_count into email_count;

  return ip_count <= 10 and email_count <= 5;
end;
$$;

revoke all on function public.consume_contact_submission_rate_limit(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_contact_submission_rate_limit(text, text)
  to service_role;

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
  where window_started_at < now() - interval '1 day';
end;
$$;

revoke all on function public.purge_expired_backend_data()
  from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_backend_data() to postgres;

commit;
