# Paws Next Door

A green-and-white, accessible community-service site with a rolling 30-day walking calendar and a Supabase administrator dashboard. This branch is for review; no site has been published and no live database has been changed.

## Review locally

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open the Local URL printed by Vite:

- `/` — public website. Without Supabase configuration, the calendar explains that requests are not open and accepts nothing.
- `/?preview=1` — **read-only design preview**, with explicitly labeled sample walking times.
- `/?preview=1#admin` — read-only dashboard preview with fictional customer data. All writes are disabled; this does not authenticate to Supabase.
- `/#admin` — real administrator login after setup.

The preview flag never connects to Supabase and cannot read or change actual customer data. Do not use it as the link for requesting real walks.

```sh
npm test
npm run build
```

See [SETUP.md](SETUP.md) for the Supabase project, administrator account, timezone, and hosting steps. Follow its live smoke test before accepting real requests.

## What is included

- Responsive green-and-white design, clear mission and process, keyboard focus states, labeled forms, FAQs and privacy explanation.
- Calendar covers today through day 29 in the **service timezone**, including month/year changes. Only future, open, unblocked, unreserved slots are shown. Each walk is 30 minutes.
- Private administrator login: add or close/reopen slots, block/unblock whole dates, review requests, approve, decline, and cancel. Data is cleared from the dashboard on sign-out or session expiry.
- PostgreSQL range exclusion prevents overlapping walking times; a partial unique index allows only one pending/approved request per slot. Database transactions serialize booking and administration changes.
- Server-verified Cloudflare Turnstile gate for public submissions, with restricted database execution and per-contact limits.
- Row-level security and restricted grants: visitors cannot read appointment records, edit slots, or appoint themselves as admins. Public calendar output contains only slot IDs, dates/times, timezone and window boundaries.
- Explicit read-only design preview and a CI workflow that tests/builds without deployment.

Approving in the dashboard **does not send an email or text**. The service team must contact the neighbor directly. Requested times are held until an administrator resolves them; there is no automatic expiry. Availability starts empty and must be added by an administrator. One team can walk one dog at a time; multiple simultaneous walkers are outside this design.

## Source map

- `src/app.js` — public and administrator interface; customer values use text nodes, never HTML insertion.
- `src/api.js` — Supabase Auth, Edge Function submission, RPCs and paginated administrator reads.
- `src/calendar.js` — date/window rendering helpers and service-timezone formatting.
- `supabase/functions/request-walk/` and `supabase/functions/_shared/` — server-only CAPTCHA verification and restricted booking gateway.
- `src/config.js` — rejects secret/service-role keys during builds.
- `supabase/migrations/202611100001_booking.sql` — schema, constraints, RLS, grants and RPCs.
- `tests/` — date boundaries, DOM flows, key validation, and PostgreSQL permissions and lifecycle checks.

Database tests run the migration in PGlite (an embedded PostgreSQL engine) with Supabase-like roles and an `auth.uid()` shim. They test real PostgreSQL RLS/constraints, but do not replace testing Supabase Auth, PostgREST, email delivery, live Turnstile verification, or simultaneous transactions against your hosted project. DOM tests use JSDOM, not a rendered browser. Browser visual QA was unavailable in this task's tool environment; review desktop/mobile layouts before launch.

## Assets

The dog photograph is served locally from `public/neighborhood-dog.jpg`; source: [Unsplash image source](https://images.unsplash.com/photo-1552053831-71594a27632d). The site does not claim the pictured dog or location belongs to the service. Fonts are DM Sans and Manrope from Google Fonts, with local system fallbacks. The paw favicon is an original SVG.
