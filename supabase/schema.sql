create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  title text not null unique check (char_length(title) between 2 and 100),
  description text not null check (char_length(description) between 5 and 1000),
  icon text not null default 'Code2',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  category text not null check (char_length(category) between 2 and 120),
  description text not null check (char_length(description) between 5 and 2000),
  type text not null default 'studio',
  tags text[] not null default '{}',
  image_url text,
  is_published boolean not null default false,
  is_demo boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.social_links (
  id uuid primary key default gen_random_uuid(),
  platform text not null unique check (char_length(platform) between 2 and 40),
  label text not null check (char_length(label) between 2 and 80),
  value text not null default '',
  enabled boolean not null default false,
  sort_order integer not null default 0
);

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  email text not null check (
    char_length(email) between 5 and 254
    and email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  phone text check (phone is null or char_length(phone) <= 40),
  service text not null check (char_length(service) between 2 and 100),
  message text not null check (char_length(trim(message)) between 15 and 4000),
  status text not null default 'new' check (status in ('new', 'read', 'completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.inquiry_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  submission_count integer not null default 1
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.admin_users enable row level security;
alter table public.site_settings enable row level security;
alter table public.services enable row level security;
alter table public.projects enable row level security;
alter table public.social_links enable row level security;
alter table public.inquiries enable row level security;
alter table public.inquiry_rate_limits enable row level security;

create policy "Admins can read their own membership"
  on public.admin_users for select to authenticated
  using (user_id = auth.uid());

create policy "Public can read settings"
  on public.site_settings for select to anon, authenticated
  using (true);
create policy "Admins manage settings"
  on public.site_settings for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Public can read active services"
  on public.services for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "Admins manage services"
  on public.services for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Public can read published projects"
  on public.projects for select to anon, authenticated
  using (is_published or (select public.is_admin()));
create policy "Admins manage projects"
  on public.projects for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Public can read enabled social links"
  on public.social_links for select to anon, authenticated
  using (enabled or (select public.is_admin()));
create policy "Admins manage social links"
  on public.social_links for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Public can submit new inquiries"
  on public.inquiries for insert to anon, authenticated
  with check (
    status = 'new'
    and char_length(trim(name)) between 2 and 120
    and char_length(message) between 15 and 4000
  );
create policy "Admins can read inquiries"
  on public.inquiries for select to authenticated
  using ((select public.is_admin()));
create policy "Admins can update inquiries"
  on public.inquiries for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "Admins can delete inquiries"
  on public.inquiries for delete to authenticated
  using ((select public.is_admin()));

create or replace function public.limit_public_inquiries()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_headers jsonb;
  forwarded_for text;
  request_ip_hash text;
  current_count integer;
begin
  request_headers := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
  forwarded_for := split_part(coalesce(request_headers ->> 'x-forwarded-for', 'unknown'), ',', 1);
  request_ip_hash := md5(trim(forwarded_for));

  insert into public.inquiry_rate_limits (ip_hash)
  values (request_ip_hash)
  on conflict (ip_hash) do update
  set
    submission_count = case
      when public.inquiry_rate_limits.window_started_at < now() - interval '1 hour' then 1
      else public.inquiry_rate_limits.submission_count + 1
    end,
    window_started_at = case
      when public.inquiry_rate_limits.window_started_at < now() - interval '1 hour' then now()
      else public.inquiry_rate_limits.window_started_at
    end
  returning submission_count into current_count;

  if current_count > 5 then
    raise exception 'Inquiry rate limit exceeded' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.limit_public_inquiries() from public;
revoke all on public.inquiry_rate_limits from anon, authenticated;

create trigger limit_public_inquiry_submissions
  before insert on public.inquiries
  for each row execute function public.limit_public_inquiries();

grant select on public.site_settings, public.services, public.projects, public.social_links to anon, authenticated;
grant insert (name, email, phone, service, message) on public.inquiries to anon, authenticated;
grant select, insert, update, delete on public.admin_users, public.site_settings, public.services, public.projects, public.social_links, public.inquiries to authenticated;

insert into public.site_settings (key, value)
values
  ('site_content', '{
    "hero_heading": "Technology that takes your business further.",
    "hero_description": "Your Partner in Software Development and Digital Transformation.",
    "about_heading": "Good technology should make the next step feel possible.",
    "about_paragraph_1": "SS Solutions brings software development and digital services together to help businesses work smarter, communicate clearly, and keep moving forward.",
    "about_paragraph_2": "Whether you need a new digital experience, a tailored software solution, or reliable technical support, we focus on making the process straightforward and the result genuinely useful.",
    "footer_tagline": "Your Partner in Software Development and Digital Transformation.",
    "cta_text": "Start a conversation"
  }'::jsonb),
  ('seo', '{
    "title": "SS Solutions — Software & Digital",
    "description": "SS Solutions is your partner in software development and digital transformation."
  }'::jsonb)
on conflict (key) do nothing;

insert into public.services (title, description, icon, is_active, sort_order)
values
  ('Web Development', 'Fast, responsive websites and web applications built around the way your business works.', 'Code2', true, 1),
  ('Software Solutions', 'Practical, purpose-built software that simplifies tasks and supports your next stage of growth.', 'Cpu', true, 2),
  ('IT Support', 'Dependable technical guidance to help your systems stay secure, stable, and productive.', 'LifeBuoy', true, 3),
  ('PC Optimization', 'Windows performance and startup optimization, system cleanup, software and system troubleshooting, gaming performance optimization, and Windows configuration and maintenance.', 'Gauge', true, 4),
  ('UI/UX Design', 'Thoughtful digital experiences that make complex products feel clear and natural to use.', 'LayoutDashboard', true, 5),
  ('Graphic Design', 'Cohesive visual assets that help your brand show up with confidence across every touchpoint.', 'PenTool', true, 6),
  ('Digital Marketing', 'Digital campaigns and content shaped to connect your business with the right audience.', 'Megaphone', true, 7)
on conflict (title) do nothing;

insert into public.projects (title, category, description, type, tags, is_published, is_demo, sort_order)
values
  ('Orbit Commerce', 'E-commerce concept', 'A refined storefront concept focused on product discovery, a calm shopping flow, and a mobile-first experience.', 'commerce', array['Web design', 'Development'], true, true, 1),
  ('Northstar Insights', 'Analytics dashboard concept', 'A clear, data-led dashboard concept that turns business metrics into a more approachable daily view.', 'analytics', array['Product design', 'UI/UX'], true, true, 2),
  ('Forma Studio', 'Creative portfolio concept', 'A distinctive portfolio concept combining expressive art direction with a simple, considered browsing experience.', 'studio', array['Branding', 'Web design'], true, true, 3)
on conflict do nothing;

insert into public.social_links (platform, label, value, enabled, sort_order)
values
  ('whatsapp', 'WhatsApp', '94775984372', true, 1),
  ('email', 'Email', 'gitco200@gmail.com', true, 2),
  ('discord', 'Discord', 'https://discord.com/users/1146014690279964763', true, 3)
on conflict (platform) do nothing;

insert into storage.buckets (id, name, public)
values ('project-images', 'project-images', true)
on conflict (id) do update set public = true;

create policy "Public can read project images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'project-images');
create policy "Admins can upload project images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-images' and (select public.is_admin()));
create policy "Admins can update project images"
  on storage.objects for update to authenticated
  using (bucket_id = 'project-images' and (select public.is_admin()))
  with check (bucket_id = 'project-images' and (select public.is_admin()));
create policy "Admins can delete project images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-images' and (select public.is_admin()));
