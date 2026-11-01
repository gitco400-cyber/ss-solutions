# SS Solutions

Responsive React + Vite company website with a GitHub Pages-compatible, Supabase-backed admin dashboard. The existing logo is served from `public/logo.png` using Vite's base URL.

## Run locally

```sh
npm install
Copy-Item .env.example .env.local
npm run dev
```

The public website works without Supabase, using its built-in content and the supplied WhatsApp, email, and Discord destinations. Contact form submissions and administrator features require a configured Supabase project; the form reports clearly when storage is not configured.

## Supabase setup

1. Create a Supabase project and open its SQL Editor.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) once. It creates the content tables, starter services and demo projects, contact links, Storage bucket, administrator checks, RLS policies, and a five-submissions-per-hour per-IP inquiry limit. The public inquiry form also has a honeypot and database field constraints.
3. In Supabase Authentication, invite the administrator by email. Public registration is not used.
4. Disable public sign-ups in the Supabase Auth settings so administrator accounts can only be invited.
5. In the SQL Editor, allowlist the invited user's Auth UUID:

   ```sql
   insert into public.admin_users (user_id)
   values ('<AUTH_USER_UUID>');
   ```

6. Add the public project URL and **anon/publishable** key to `.env.local` using the variable names listed in the Visitor Analytics configuration section. These values are intended for the browser. Never put a Supabase `service_role` key in this project, GitHub variables, or any `VITE_*` setting.
7. In the GitHub repository's **Settings → Secrets and variables → Actions → Variables**, define `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the Pages build. The deployment workflow reads these public configuration variables and stops with an explicit error if either is missing, preventing a deployment that silently shows only demo content. Local builds can still run without Supabase; the website keeps its built-in demo content when a configured Supabase connection genuinely fails.
8. Check the Supabase Auth URL configuration allows the deployed site origin: `https://gitco200-cyber.github.io/ss-solutions/`.

The SQL file is intended for a new project and should be applied once. If you have existing production tables or policies, review and adapt the SQL before applying it.

## Admin dashboard

Open [`https://gitco200-cyber.github.io/ss-solutions/#/admin`](https://gitco200-cyber.github.io/ss-solutions/#/admin). The route requires a Supabase Auth session and a matching row in `public.admin_users`; database RLS is the actual authorization boundary. There is no public signup.

The dashboard supports:

- Website text and SEO title/description editing.
- Service create, edit, activate/deactivate, and delete.
- Project create, edit, publish/unpublish, demo labeling, and image uploads (JPG, PNG, WebP, GIF, or AVIF up to 5 MB). Replaced, removed, or project-deleted images are removed from Storage only when no project references them.
- Inquiry search, status updates, and deletion.
- Editable social/contact destinations with enable/disable, validation, preview, and persistence.
- Administrator password updates and logout.

The public site reads active/published content from Supabase and displays only enabled destinations with valid URLs. It fetches current public data on page load, refreshes after public-facing changes made in another dashboard tab, and checks for updates when the page becomes visible again. If a request fails, previously loaded content stays visible and a status notice identifies any built-in preview content. Use the notice's refresh action to retry immediately. Starter portfolio items are explicitly marked as demonstration concepts. Starter contact details are the supplied WhatsApp number, business email, and Discord profile; Facebook, Instagram, and LinkedIn are not enabled by default.

The public website defaults to its dark theme and includes a navbar theme toggle. A visitor's light/dark choice is saved in browser local storage and applied before the page renders. The administrator dashboard remains dark independently of the public theme. Public sections use fluid widths with a wider maximum content width for large screens.

## Visitor Analytics setup

The public website records each page load through the `visitor-analytics` Supabase Edge Function with a separate visit ID, while retaining random visitor and session IDs. It collects only page paths, visit timestamps, device category, available operating-system/browser details, screen and viewport dimensions, device pixel ratio, browser language, and a device model only when the browser supplies one. Unknown details remain `Unknown`. It does not request geolocation, collect referrers or time zones, or store precise location or IP addresses. The trusted gateway IP is used transiently to compute an HMAC rate-limit key; the raw IP is not stored or logged.

### Configuration and secrets

The browser build requires only these public configuration variable names:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (a publishable key or legacy `anon` key)

Set them in an ignored local `.env.local` for development and in the GitHub Pages build environment for production. The public key is expected to be present in frontend output; it must never be a service-role or secret key. Supabase provides `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` to Edge Functions. The analytics function reads the `default` entry in `SUPABASE_SECRET_KEYS`, checks the format/role of a Supabase secret key or legacy service-role JWT, and rejects publishable and anon keys. `VISITOR_ANALYTICS_OWNERSHIP_SECRET` is a separate Edge Function secret. Never use a `VITE_` prefix for either server-side credential.

Generate a 32-byte cryptographically random ownership secret locally, save it to a temporary ignored env file, upload it to Supabase, and remove the local file. In PowerShell from the repository root:

```powershell
node -e "require('node:fs').writeFileSync('.supabase-secrets.local', 'VISITOR_ANALYTICS_OWNERSHIP_SECRET=' + require('node:crypto').randomBytes(32).toString('base64url'))"
supabase secrets set --env-file .supabase-secrets.local
Remove-Item -Force .supabase-secrets.local
```

The Edge Function accepts only a 32-byte hex or canonical base64url secret and rejects short, repeated, placeholder-like, and highly printable values. Do not copy the generated value into chat, source code, `.env`, GitHub Actions, or logs. Keep the same secret across deployments. Rotation invalidates existing browser ownership tokens; affected visitors must clear this site's local storage to obtain a new token.

### Migration and deployment

The analytics migrations depend on `public.admin_users` and the existing stable, `SECURITY DEFINER` `public.is_admin()` from [`supabase/schema.sql`](./supabase/schema.sql). Review migrations and the target schema first; do not rerun the initial schema on an existing project. The initial analytics migration creates the original analytics schema; the later device-only migration removes its location-specific schema. The device-only migration has a preflight that checks the expected table columns, RLS/grants, admin-only policies, helper functions, and conflicting objects before DDL. It adds nullable viewport dimensions without backfilling existing visit rows. It explicitly and irreversibly drops GPS coordinates, location consent/permission metadata, referrer and time-zone columns, and the short-lived GPS challenge table/function and any remaining challenge rows, while preserving all visitor analytics visit rows, IDs, timestamps, and device fields. It replaces the summary RPC with device-only counts and retains its admin authorization and grants. Review and back up the target before applying; do not run migrations against production without your own review and approval. The migration is wrapped in a PostgreSQL transaction, so DDL and function changes roll back together if the runner stops on an error.

From the repository root, after review and explicit approval:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy visitor-analytics
```

The function is configured with `verify_jwt = false` because visit ingestion is public. It accepts only initialization and device-only visit events, validates a strict payload allowlist, verifies visitor ownership with HMAC, and never returns stored analytics records. Supabase supplies `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` to the Edge Function; only the function uses the `default` server-side credential.

Rate limiting reads only `cf-connecting-ip`, validates its IP syntax, hashes it with HMAC, and fails closed if absent or malformed. It does not trust `x-forwarded-for` or other client-controlled forwarding headers. This protection depends on the deployed Supabase gateway stripping/overwriting client-supplied `cf-connecting-ip` and supplying a trustworthy value. Repository inspection cannot verify that gateway behavior: confirm it with a controlled deployed test before treating the IP limit as an anti-abuse boundary. If the gateway cannot guarantee that header, this endpoint intentionally returns an error rather than falling back to visitor IDs, which callers can rotate.

### Device-data privacy

The site never calls the browser geolocation API and has no location-consent UI, GPS challenge, coordinate storage, or map integration. The analytics payload contains no referrer, time zone, or IP address. Device brand remains `Unknown` because browsers do not reliably expose it; model remains `Unknown` unless the browser provides a model hint. Screen/viewport dimensions and language are browser-reported values and may be unavailable.

The browser-held ownership token is a bearer credential and remains vulnerable to same-origin script compromise or control of the visitor's browser. The Edge Function uses the gateway IP only to calculate a keyed, non-reversible rate-limit hash and fails closed if the trusted header is unavailable; repository inspection cannot prove the deployed gateway supplies a trustworthy header.

Analytics are not automatically deleted. The Admin Panel provides an explicit, confirmation-protected deletion for records older than 1–3650 days. Review retention according to applicable privacy requirements. The summary counts distinct visitor IDs within the selected date range.

### Local validation

```sh
npm run lint
npm run build
deno check --no-lock supabase/functions/visitor-analytics/index.ts
deno test --no-lock supabase/functions/visitor-analytics/security_test.ts
git diff --check
```

For local end-to-end testing, use a local Supabase stack (`supabase start`) with a local-only function env file ignored by Git, then serve the function with `supabase functions serve visitor-analytics --env-file PATH_TO_LOCAL_FUNCTION_ENV`. Never use production secrets for local development. Apply/test migrations only against the local stack or a disposable staging project. The commands above are local checks only; they do not verify production database compatibility or Supabase gateway headers.

## GitHub Pages

The Vite base path is `/ss-solutions/`. The public website uses hash-based admin navigation (`#/admin`), so the route works on static hosting without server rewrites. All `public/` assets use Vite's base URL.

## Build and lint

```sh
npm run build
npm run lint
```
