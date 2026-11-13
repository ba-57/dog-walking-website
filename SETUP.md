# Paws Next Door — setup and operations

**Status: LIVE.** The redesigned Paws Next Door website is published at https://ba-57.github.io/dog-walking-website/ with its private admin interface at https://ba-57.github.io/dog-walking-website/#admin. The initial Supabase setup, Turnstile configuration, and launch checks have been completed. The sections below remain as reference material for recreating a test environment, maintaining the service, or onboarding another administrator. Do **not** rerun the database migration in the existing production project.

## 1. Create Supabase and apply the database migration

1. Create a Supabase project in your account. Use a strong database password and your chosen region.
2. In the SQL Editor, run the complete contents of `supabase/migrations/202611100001_booking.sql` **once** on the fresh project. Alternatively apply it through your normal Supabase CLI migration process. It creates five tables, RLS policies, grants, and the booking/admin RPCs.
3. Set the service's actual IANA timezone before adding any availability. UTC is the initial default. For example, if your service operates on Chicago local time:

   ```sql
   update public.service_settings
   set timezone = 'America/Chicago'
   where id = true;
   ```

   Choose your actual service timezone; the example does not assume your location. Check names with `select name from pg_timezone_names order by name;`. Never change timezone after scheduling appointments without reviewing every existing slot and blocked date. Browser timezone is not used for service dates or input times.

No example availability or real customer data is seeded by the migration. Admin controls add dates only within today + 29 days, in the service timezone. Daylight-saving gaps are rejected; for an ambiguous fall-back hour PostgreSQL chooses the standard-time occurrence. Prefer daytime walking hours.

## 2. Create your administrator account

1. In Supabase **Authentication → Providers → Email**, enable email/password sign-in. Turn **Allow new users to sign up** off under Authentication settings. The website has no public sign-up flow.
2. Under **Authentication → Users**, create a user for your own email with a strong password and mark the email confirmed after verifying the address yourself. Use Supabase's admin UI; never place a password in the repository.
3. Copy that user's UUID. Run this in the SQL Editor, replacing the example UUID:

   ```sql
   insert into public.admin_users (user_id)
   values ('YOUR-AUTH-USER-UUID');
   ```

   Only project owners/database administrators can grant membership. Creating an Auth user alone does not grant dashboard or customer-data access. Do not put admin roles in user-editable user metadata.

4. Configure your Auth Site URL and allowed redirect URLs for your eventual HTTPS domain and localhost during development. Set SMTP and email templates if you will use Supabase invitations/password-reset emails. The website itself uses email/password login; account recovery is managed through Supabase, not a custom recovery screen.
5. Set an appropriate Auth session lifetime in Supabase. Sessions use tab-scoped `sessionStorage`. Sign out on shared devices. To revoke an administrator immediately, remove their row from `admin_users` and revoke their Supabase sessions.

## 3. Enable the secure request gateway

1. In Cloudflare Turnstile, create a **managed** widget. Add your production hostname (for example `ba-57.github.io`) and `localhost` for development. Keep the site key and secret key separate.
2. In Supabase **Edge Functions → Secrets**, add `TURNSTILE_SECRET_KEY` with the widget's secret. Add `BOOKING_ALLOWED_ORIGINS` with the exact allowed website origins, separated by commas. For example:

   ```text
   http://localhost:5173,https://ba-57.github.io
   ```

   Origins include scheme, host and non-default port, with no path or trailing slash. Add your custom domain instead if applicable. Do not use `*`. These are example settings; choose your actual review and production origins. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its hosted Edge Functions automatically. The service-role key stays on the server; never add it to the website's Vite environment.

3. With the Supabase CLI installed, sign in using its secure login flow and deploy the included function:

   ```sh
   supabase login
   supabase functions deploy request-walk --project-ref YOUR_PROJECT_REF
   ```

   `supabase/config.toml` disables JWT verification **only for this public function**. The function itself checks the allowed origin and verifies a one-use Turnstile token with the expected hostname and `walk_request` action before saving. All admin operations still require Supabase Auth. Direct public calls to the database's `request_walk` function are denied, so bypassing the web form cannot bypass CAPTCHA verification.

4. The database also enforces a three-requests-per-normalized-email-per-24-hours limit. CAPTCHA plus this limit provides a baseline for the volunteer service; consider additional provider rate limits if traffic warrants them. Do not log request bodies, contact details, tokens or secrets.

Until both the Edge Function and CAPTCHA are configured, real visitor requests fail closed. A missing public site key disables the form's submit button.

## 4. Connect the local website

Copy `.env.example` to `.env.local` and enter:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_TURNSTILE_SITE_KEY=YOUR_TURNSTILE_SITE_KEY
VITE_BASE_PATH=/
```

Use the project's **publishable** key (or legacy **anon** key) from Supabase's API settings. These Supabase values and the Turnstile site key are intentionally public in the browser bundle; the database policies protect private data. **Never use a secret or service-role key.** Build validation rejects those keys. Do not paste secrets into chat or commit `.env.local`.

Restart the dev server after configuration changes. Run `npm run dev`, open `/#admin`, sign in, and add walking times. The public calendar should immediately reflect them after clicking Refresh times. To change a time, close the old slot and add a new one. Active requests must be declined/cancelled before their slot can be changed. Closed slots remain in the dashboard and can be reopened. Blocking a date retains the slots but removes them from public availability until unblocked.

## 5. Regression testing for future changes

Use fictional details only until these checks pass:

1. Sign in as admin and add future 30-minute times. Confirm the displayed timezone and date boundaries. Confirm overlapping times are rejected.
2. Open the public site in two separate private browser windows. Select the **same** slot in both, then submit both forms as close together as possible. Complete each window’s security check. Exactly one should succeed; the other should be told to choose another time. Check the dashboard for one active request.
3. Confirm the pending time disappears publicly, approve the request, and confirm it stays unavailable. Contacting the neighbor is a manual step; no email/SMS is sent by this application.
4. Decline or cancel a test request. Its future slot should become available again. Closed/blocked/past/out-of-window slots must never accept a request, including from an already-open stale browser tab.
5. Add a date block. Public slots on that date should disappear; unblocking restores eligible times. A date with active requests cannot be blocked until those requests are handled.
6. Sign out. The dashboard must clear. Use a separate, non-admin test Auth account to confirm it cannot load records or call admin functions. A direct REST read of `appointments` with only the public key must fail. With a non-admin user token it must return no rows. `admin_users` must be inaccessible in both cases.
7. Review on a phone and desktop, test keyboard navigation and form errors, and verify that only your admin can see contact details.
8. Test interrupted connections and an expired admin session. The site must show an error, disable stale public availability, and clear private data on session expiry.

Automated `npm test` covers the application DOM and PostgreSQL policies/constraints locally. Hosted Auth/REST wiring and independent-session concurrency require this test project smoke test. The CAPTCHA must also reject an absent, expired, wrong-host or replayed token without creating an appointment. Direct anonymous calls to `request_walk` must fail with a permission error. The GitHub review-checks workflow runs tests and builds only; it never publishes. The separate Pages workflow can deploy only from `main` after the owner approves and merges.

## 6. GitHub Pages hosting and updates

Follow [DEPLOYMENT.md](DEPLOYMENT.md) for the current production instructions. The production command is `npm run build:pages`; it uses `/dog-walking-website/`, requires all three public build variables, and verifies the `dist/` artifact. `npm run preview:pages` serves that build at `http://localhost:5173/dog-walking-website/`.

The review workflow builds and tests without publishing. The separate Pages workflow tests, builds, and deploys on pushes to `main` after changes are reviewed and merged. GitHub Pages already uses GitHub Actions, and the original launch pull request was merged. For future changes, use a new branch and pull request; avoid publishing the repository's raw Vite source files.

## 7. Operating the service

- Resolve pending requests promptly. They reserve availability indefinitely until approved, declined or cancelled.
- Contact the neighbor after approving/declining/cancelling; automated notifications are not included. Agree on a meeting point after confirmation rather than collecting full addresses publicly.
- Define your service area, response time, volunteer screening and safe dog-handling practices before launch. The site avoids making unverified claims about screening, insurance or coverage.
- Restrict Supabase project access, enable project backups appropriate to your plan, and keep dependencies current. Do not enable public table policies or expose service-role credentials to “fix” permissions.
- Agree on a retention period and remove expired customer data through trusted Supabase administration. The public FAQ lets neighbors request deletion through the team. No automatic retention job or automated outbound messaging is configured.
- Public visitors do not need accounts. The Turnstile-verifying Edge Function is the only public submission path. Leave direct `request_walk` access restricted to `service_role`; do not grant it to `anon` or `authenticated`. Admin functions validate membership independently of their execute grants.
