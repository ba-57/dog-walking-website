# Paws Next Door

A live, green-and-white community-service website with a rolling 30-day dog-walking calendar, Supabase-backed booking requests, and a private administrator dashboard.

**Live website:** https://ba-57.github.io/dog-walking-website/  
**Admin sign-in:** https://ba-57.github.io/dog-walking-website/#admin

The redesigned site was published to GitHub Pages after pull request #1 was merged into `main`. GitHub Actions builds and deploys approved changes pushed to `main`. The Supabase database and secure request Edge Function are hosted separately.

## Run locally for development

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
# Real production build, using your local public configuration:
npm run build:pages
npm run preview:pages
```

See [SETUP.md](SETUP.md) for initial Supabase setup and ongoing operations, and [DEPLOYMENT.md](DEPLOYMENT.md) for the production configuration, deployment workflow, and subsequent updates. Production preview is `http://localhost:5173/dog-walking-website/`; admin login is the same URL with `#admin`.

## What is included

- Responsive green-and-white design, clear mission and process, keyboard focus states, labeled forms, FAQs and privacy explanation.
- Calendar covers today through day 29 in the **service timezone**, including month/year changes. Only future, open, unblocked, unreserved slots are shown. Each walk is 30 minutes.
- Private administrator login: add or close/reopen slots, block/unblock whole dates, review requests, approve, decline, and cancel. Data is cleared from the dashboard on sign-out or session expiry.
- PostgreSQL range exclusion prevents overlapping walking times; a partial unique index allows only one pending/approved request per slot. Database transactions serialize booking and administration changes.
- Server-verified Cloudflare Turnstile gate for public submissions, with restricted database execution and per-contact limits.
- Row-level security and restricted grants: visitors cannot read appointment records, edit slots, or appoint themselves as admins. Public calendar output contains only slot IDs, dates/times, timezone and window boundaries.
- Explicit read-only design preview and PR checks that build the real production artifact without deployment.
- The Pages workflow deploys from `main` after reviewed changes are merged; production builds always use `/dog-walking-website/` and reject missing/example configuration or detected private credentials.

Approving in the dashboard **does not send an email or text**. The service team must contact the neighbor directly. Requested times are held until an administrator resolves them; there is no automatic expiry. Availability starts empty and must be added by an administrator. One team can walk one dog at a time; multiple simultaneous walkers are outside this design.

## Source map

- `src/app.js` — public and administrator interface; customer values use text nodes, never HTML insertion.
- `src/api.js` — Supabase Auth, Edge Function submission, RPCs and paginated administrator reads.
- `src/calendar.js` — date/window rendering helpers and service-timezone formatting.
- `supabase/functions/request-walk/` and `supabase/functions/_shared/` — server-only CAPTCHA verification and restricted booking gateway.
- `src/config.js` — rejects secret/service-role keys during builds.
- `supabase/migrations/202611100001_booking.sql` — schema, constraints, RLS, grants and RPCs.
- `scripts/build-pages.mjs` and `scripts/check-pages-build.mjs` — validated Pages build, asset checks, environment-file checks and credential-pattern scanning.
- `.github/workflows/pages.yml` — main-only GitHub Pages deployment; `checks.yml` never deploys.
- `tests/` — date boundaries, DOM flows, key validation, and PostgreSQL permissions and lifecycle checks.

Database tests run the migration in PGlite (an embedded PostgreSQL engine) with Supabase-like roles and an `auth.uid()` shim. They test real PostgreSQL RLS/constraints, but do not replace testing Supabase Auth, PostgREST, email delivery, live Turnstile verification, or simultaneous transactions against your hosted project. DOM tests use JSDOM, not a rendered browser. The owner completed local end-to-end checks for login, availability, Turnstile, booking and approve/decline, and subsequently confirmed that the live GitHub Pages website and a production booking test worked. Automated tests and these smoke checks are not a comprehensive security or accessibility audit.

## Assets

The dog photograph is served locally from `public/neighborhood-dog.jpg`; source: [Unsplash image source](https://images.unsplash.com/photo-1552053831-71594a27632d). The site does not claim the pictured dog or location belongs to the service. Fonts are DM Sans and Manrope from Google Fonts, with local system fallbacks. The paw favicon is an original SVG.
