# SS Solutions

Responsive React + Vite company website with a GitHub Pages-compatible Supabase admin dashboard. The existing public layout, logo, and visual assets are served from `public/` using Vite's base URL.

## Run locally

```powershell
Copy-Item .env.example .env.local
supabase start
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the ignored `.env.local` using the local API URL and public anon/publishable key printed by `supabase start`. Do not copy any service-role key or other private credential into a `VITE_*` variable. The public website still runs in preview mode when these values are blank or Supabase is unavailable.

Stop the local Supabase containers with `supabase stop`.

## Supabase backend

The new-project schema is managed only by the ordered SQL migrations in `supabase/migrations/`. The initial migration creates the existing site-content tables, inquiry handling, administrator authorization, RLS policies, public project-image bucket, seed content, and retention job. A fresh local database applies active migrations through the Supabase CLI; do not manually run archived SQL.

Historical setup and visitor-analytics SQL is preserved under `supabase/archive/legacy-backend/`, outside the active migration directory so the new backend cannot accidentally apply the legacy analytics creation or deletion scripts. Do not copy these files back into `supabase/migrations/` or run them against the new project. The active `visitor_device_analytics` migration creates a new consent-gated device analytics schema; it does not restore legacy GPS or location collection.

### Admin provisioning

Public sign-up is disabled in local configuration. For the new project, invite an administrator through Supabase Auth, then insert that Auth user's UUID into the allowlist:

```sql
insert into public.admin_users (user_id)
values ('<AUTH_USER_UUID>');
```

The dashboard checks this allowlist, but database RLS is the actual authorization boundary. Do not grant authenticated users write access to `admin_users`; provision or revoke administrator membership only through a trusted operator.

### Data and access boundaries

- Anonymous visitors can read only public site settings, active services, published projects, and enabled social links.
- The contact form submits only through the public `contact-submit` Edge Function. The server validates and normalizes every field, checks the honeypot, rate-limits using HMAC-derived identifiers for both a trusted client IP and normalized email, and writes inquiries with its server-side service role. The database migration revokes direct inquiry inserts from anonymous and authenticated clients. The browser honeypot is not a security boundary.
- The function fails closed unless `CONTACT_TRUSTED_IP_HEADER_VERIFIED=true` is explicitly configured, and then only reads `cf-connecting-ip`; it never uses payload addresses or arbitrary `x-forwarded-for` values. This repository does not establish that Supabase's deployed ingress overwrites/removes a caller-supplied header. Do not set the verification flag until authoritative deployment documentation or an independently verified ingress configuration establishes that guarantee. If it cannot be established, contact submissions remain disabled until a trusted proxy is configured to strip inbound forwarding headers and inject a verified client address.
- Rate limits are at most 10 accepted attempts per trusted IP per hour and five per normalized email per hour. HMAC keys use a server-only secret and are kept in a client-inaccessible table. The email bucket is additional protection; it is not the sole limiter. Shared IPs may share an IP quota.
- The private HMAC bucket table has a hard 10,000-row cap and removes buckets idle for more than one day. Requests exceeding an IP quota do not create new email buckets. When capacity is full, new identifiers receive a temporary-unavailable response (503), rather than bypassing limits or writing inquiries; legitimate visitors may be temporarily blocked until hourly cleanup or a request frees expired buckets.
- Administrators can manage website content and inquiries through RLS. Inquiry status updates are limited to the status column; completion timestamps are set by the database.
- Completed inquiries are deleted after 365 days from completion by an hourly `pg_cron` job. New and read inquiries are not automatically deleted.
- Visitor device analytics is opt-in. The public website records a random visitor ID, session ID, page path, device category, normalized OS/browser/version, an explicitly exposed browser model when available, and a coarse screen bucket. It does not store raw IPs, raw user-agent strings, exact screen dimensions, location, or GPS. Visits are deduplicated by a random visit UUID, readable only to allowlisted administrators, and removed after 90 days. Consent records expire after 90 days of inactivity; withdrawing consent deletes that visitor's records immediately when the function is available.
- The visitor analytics function requires a verified ingress client-IP header and a server-only HMAC key for its per-IP rate limiter. It accepts only the configured `cf-connecting-ip` header through the shared strict ingress gate and never falls back to request payloads or forwarded headers. This repository does not establish that Supabase's deployed ingress overwrites caller values. Leave `VISITOR_ANALYTICS_TRUSTED_IP_HEADER_VERIFIED` unset or false unless reliable deployment evidence or a trusted proxy establishes that guarantee. Without it, consent registration, revocation, and analytics collection fail closed; the public website remains available and does not send analytics events successfully.
- Analytics rate limiting allows at most 60 function requests per verified IP per hour. HMAC buckets are capped at 50,000 rows and removed after one day idle; a full bucket table temporarily blocks new identifiers with 503. Consent storage is capped at 100,000 active visitor IDs. This shared-IP quota and capacity limit may temporarily block legitimate visitors.
- The `project-images` bucket is intentionally public-read for portfolio images. Upload, update, and delete require an allowlisted administrator; accepted image types and uploads are limited to 5 MB.
- Only the public project URL and anon/publishable key belong in frontend environment variables. Never put a Supabase service-role key or private function secret in frontend code, `.env.example`, or GitHub Pages build variables.

### Contact function environment and deployment

The Edge Function requires `CONTACT_RATE_LIMIT_HMAC_SECRET` (a canonical base64url encoding of exactly 32 cryptographically random bytes), `CONTACT_TRUSTED_IP_HEADER=cf-connecting-ip`, and `CONTACT_TRUSTED_IP_HEADER_VERIFIED=true`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime; do not copy those server credentials into the Vite environment. The verification flag is an operator gate, not proof: this repository has not verified that Supabase ingress overwrites caller-supplied values. Leave it false and do not deploy an enabled contact endpoint until the ingress trust boundary is supported by reliable evidence or a trusted proxy is configured.

For local development, create an ignored `supabase/functions/.env.local` containing these names and local-only values. Generate a fresh random secret directly into the ignored file without printing it:

```powershell
node -e "require('node:fs').writeFileSync('supabase/functions/.env.local', 'CONTACT_RATE_LIMIT_HMAC_SECRET=' + require('node:crypto').randomBytes(32).toString('base64url') + '\nCONTACT_TRUSTED_IP_HEADER=cf-connecting-ip\nCONTACT_TRUSTED_IP_HEADER_VERIFIED=false\n')"
```

Run the local stack and function without contacting a remote project:

```powershell
supabase start
supabase functions serve contact-submit --env-file supabase/functions/.env.local
```

The local Edge Function intentionally refuses to start while the verification flag is false. Change it only after verifying that the local ingress overwrites the header; the Deno handler tests use a controlled test IP and do not establish ingress trust.

Before any **separately approved** remote deployment, obtain reliable evidence for the IP-header trust boundary and create an ignored production env file with a unique random secret. Keep the verification flag false unless and until the boundary is verified. Only then store the secrets with Supabase Functions, apply the reviewed migrations, and deploy:

```powershell
node -e "require('node:fs').writeFileSync('supabase/functions/.env.production', 'CONTACT_RATE_LIMIT_HMAC_SECRET=' + require('node:crypto').randomBytes(32).toString('base64url') + '\nCONTACT_TRUSTED_IP_HEADER=cf-connecting-ip\nCONTACT_TRUSTED_IP_HEADER_VERIFIED=false\n')"
supabase link --project-ref <new-project-ref>
supabase secrets set --env-file supabase/functions/.env.production
supabase db push
supabase functions deploy contact-submit
Remove-Item -Force supabase/functions/.env.production
```

Replace `<new-project-ref>` with the verified reference for the new project only; never link this repository to an old project.
The production env file is ignored by the repository's `.env.*` rule. It must not contain `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_URL`, and must never be committed or printed. Supply only the HMAC secret, header name, and verified flag; Supabase injects its server credentials into the function. Do not run these remote commands until the new project is intentionally selected and the ingress header has been verified. No such verification was performed for this change.

### Contact security tests

Run the handler tests locally with:

```powershell
deno test supabase/functions/contact-submit/security_test.ts
supabase start
supabase test db
```

The Deno tests cover accepted submissions, server-side honeypot handling, invalid input, rate limiting, missing trusted IP, HMAC/database failure, storage capacity, and IP parsing. The database test exercises anonymous insert denial, authenticated non-admin inquiry read/update/delete denial, authorized admin operations, rate-limit expiration/cleanup, capacity handling, and RPC privileges.

### Visitor device analytics setup and validation

The function uses Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only inside the Edge Function runtime. Set these server-side values for `visitor-analytics`:

- `VISITOR_ANALYTICS_RATE_LIMIT_HMAC_SECRET`: a canonical base64url encoding of exactly 32 cryptographically random bytes.
- `VISITOR_ANALYTICS_TRUSTED_IP_HEADER`: `cf-connecting-ip`.
- `VISITOR_ANALYTICS_TRUSTED_IP_HEADER_VERIFIED`: `true` only after verifying that the deployment ingress overwrites/removes any caller-supplied value for that header.

Do not put these values in `.env`, `.env.example`, a `VITE_*` variable, or GitHub Pages build variables. For local-only development, add the names and local values to the ignored `supabase/functions/.env.local`; keep the verification flag `false` unless the local ingress boundary is independently established. When false, the endpoint responds with temporary unavailability and does not store device analytics. Do not enable it simply to make local tests pass.

Run the local function only against the local Supabase stack:

```powershell
supabase start
supabase functions serve visitor-analytics --env-file supabase/functions/.env.local
```

The analytics dashboard is available to allowlisted administrators at **Visitor Analytics**. It shows only the last 90 days, distinguishes visits from random browser IDs, paginates recent visits, and uses an empty state when no data exists. The `pg_cron` job configured by the core migration invokes the extended cleanup function hourly.

Run the local handler and database checks with:

```powershell
deno test supabase/functions/visitor-analytics/security_test.ts
deno check supabase/functions/visitor-analytics/index.ts
supabase test db
```

Database tests cover RLS/grants, admin-only summary access, consent revocation, coarse screen constraints, 90-day deletion, one-day rate-limit expiry, and the scheduled cleanup job. Browser-side consent is optional and analytics errors do not block public content. This implementation does not collect GPS or approximate geolocation; no active location analytics pipeline was present in the worktree when this feature was added.

### GitHub Pages configuration

The Pages build reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from GitHub Actions Variables and stops if either is missing. Configure those public values only after the new project is intentionally provisioned. The site uses the `/ss-solutions/` Vite base path and hash-based admin route (`#/admin`).

## Existing dashboard and public content

The dashboard supports website text and SEO editing, service and project management, project-image uploads, inquiry status/search/deletion, social/contact settings, password updates, and logout. Public content refreshes on page load, after dashboard changes in another tab, and when a hidden tab becomes visible again.

The public website works without Supabase using built-in preview content and the configured contact-link fallbacks. If a configured content request fails, previously loaded content remains visible and the public site remains usable.

## Validation

```sh
npm run lint
npm run build
```

`supabase start` and `supabase stop` operate only on the local development stack. This documentation does not authorize linking, migrating, or deploying to a remote Supabase project.
