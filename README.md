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

6. Add the project URL and **anon/publishable** key to `.env.local`:

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-key
   ```

   These values are intended for the browser. Never put a Supabase `service_role` key in this project, GitHub variables, or any `VITE_*` setting.
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

## GitHub Pages

The Vite base path is `/ss-solutions/`. The public website uses hash-based admin navigation (`#/admin`), so the route works on static hosting without server rewrites. All `public/` assets use Vite's base URL.

## Build and lint

```sh
npm run build
npm run lint
```
