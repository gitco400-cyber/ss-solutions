begin;

alter table public.contact_submission_rate_limits
  add column last_seen_at timestamptz;

update public.contact_submission_rate_limits
set last_seen_at = window_started_at;

alter table public.contact_submission_rate_limits
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null;

delete from public.contact_submission_rate_limits
where last_seen_at < now() - interval '1 day';

with ranked_buckets as (
  select
    ctid,
    row_number() over (
      order by last_seen_at desc, window_started_at desc, identifier_type, identifier_hash
    ) as bucket_rank
  from public.contact_submission_rate_limits
)
delete from public.contact_submission_rate_limits buckets
using ranked_buckets
where buckets.ctid = ranked_buckets.ctid
  and ranked_buckets.bucket_rank > 10000;

drop index public.contact_submission_rate_limits_window_idx;
create index contact_submission_rate_limits_last_seen_idx
  on public.contact_submission_rate_limits (last_seen_at);

revoke all on table public.contact_submission_rate_limits
  from public, anon, authenticated, service_role;

drop function public.consume_contact_submission_rate_limit(text, text);

create function public.consume_contact_submission_rate_limit(
  p_ip_hash text,
  p_email_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  bucket_limit constant bigint := 10000;
  bucket_count bigint;
  ip_count integer;
  email_count integer;
  has_ip_bucket boolean;
  has_email_bucket boolean;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid contact rate-limit identifiers'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1380140099, 1);

  delete from public.contact_submission_rate_limits
  where last_seen_at < now() - interval '1 day';

  select exists (
    select 1
    from public.contact_submission_rate_limits
    where identifier_type = 'ip'
      and identifier_hash = p_ip_hash
  ) into has_ip_bucket;

  if not has_ip_bucket then
    select count(*) into bucket_count
    from public.contact_submission_rate_limits;
    if bucket_count >= bucket_limit then
      return 'capacity';
    end if;
  end if;

  insert into public.contact_submission_rate_limits (
    identifier_type,
    identifier_hash,
    window_started_at,
    request_count,
    last_seen_at
  )
  values ('ip', p_ip_hash, now(), 1, now())
  on conflict (identifier_type, identifier_hash) do update
  set
    request_count = case
      when public.contact_submission_rate_limits.window_started_at < now() - interval '1 hour' then 1
      else public.contact_submission_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.contact_submission_rate_limits.window_started_at < now() - interval '1 hour' then now()
      else public.contact_submission_rate_limits.window_started_at
    end,
    last_seen_at = now()
  returning request_count into ip_count;

  if ip_count > 10 then
    return 'limited';
  end if;

  select exists (
    select 1
    from public.contact_submission_rate_limits
    where identifier_type = 'email'
      and identifier_hash = p_email_hash
  ) into has_email_bucket;

  if not has_email_bucket then
    select count(*) into bucket_count
    from public.contact_submission_rate_limits;
    if bucket_count >= bucket_limit then
      return 'capacity';
    end if;
  end if;

  insert into public.contact_submission_rate_limits (
    identifier_type,
    identifier_hash,
    window_started_at,
    request_count,
    last_seen_at
  )
  values ('email', p_email_hash, now(), 1, now())
  on conflict (identifier_type, identifier_hash) do update
  set
    request_count = case
      when public.contact_submission_rate_limits.window_started_at < now() - interval '1 hour' then 1
      else public.contact_submission_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.contact_submission_rate_limits.window_started_at < now() - interval '1 hour' then now()
      else public.contact_submission_rate_limits.window_started_at
    end,
    last_seen_at = now()
  returning request_count into email_count;

  if email_count > 5 then
    return 'limited';
  end if;

  return 'allowed';
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
  where last_seen_at < now() - interval '1 day';
end;
$$;

revoke all on function public.purge_expired_backend_data()
  from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_backend_data() to postgres;

comment on table public.contact_submission_rate_limits is
  'Stores HMAC identifiers only; the RPC caps the table at 10000 active buckets and prunes idle buckets after one day.';

commit;
