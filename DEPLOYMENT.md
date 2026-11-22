# Paws Next Door — deployment and the custom-domain transition

**This branch prepares https://pawsnextdoor.org/ and https://pawsnextdoor.org/#admin. The domain has not been switched.** The working site remains at https://ba-57.github.io/dog-walking-website/ until the owner approves and coordinates the change.

Follow **[CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md)** for the concise settings checklist, WordPress.com DNS records, switch order, and post-switch tests. Do not merge this root-path build or change Pages/DNS independently of that plan.

## Production build and workflows

- `npm run build:pages` always builds at `/` for `pawsnextdoor.org`. It overrides an old `VITE_BASE_PATH=/dog-walking-website/` in a local environment without editing that file.
- `public/CNAME` is copied to `dist/CNAME`. The release checker requires the exact hostname `pawsnextdoor.org`, verifies assets resolve under the new origin, and scans source/output for recognizable private credentials. `.env.local` stays ignored and server-only files stay out of the artifact.
- **Review checks** runs on PRs into `main` and `feat/**` branch pushes. It tests and builds the real production artifact using existing repository variables. It cannot publish or change Pages settings.
- **Deploy Paws Next Door to GitHub Pages** still runs only on `main` pushes or a manual run from `main`. Before upload/deployment, it reads existing Pages metadata and refuses to publish unless the configured host is `pawsnextdoor.org`. The workflow does not set that hostname or change DNS itself.
- Only the deploy job has Pages write and OIDC permissions. Actions remain pinned to release commit hashes, and only `dist/` is uploaded.

For an Actions-based Pages site, GitHub ignores `CNAME` files as domain configuration. This file keeps the intended domain explicit in source and output, but **Repository Settings → Pages → Custom domain** is still required during the approved switch. Keep Source set to **GitHub Actions**.

## Existing public build variables — keep their values

The custom domain changes the frontend address, not the backend project or widget:

| GitHub Actions repository variable | Value to keep                              |
| ---------------------------------- | ------------------------------------------ |
| `VITE_SUPABASE_URL`                | `https://sfwpwzzbqnfdqnaciffk.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY`    | The existing public `sb_publishable_…` key |
| `VITE_TURNSTILE_SITE_KEY`          | The existing public Turnstile Site Key     |

These are already configured under **Repository Settings → Secrets and variables → Actions → Variables**. Do not replace the Supabase Project URL with the website URL. No new build variable or secret is required for the domain. Missing/example values stop a production build. A changed build value requires a rebuild.

Never put the Turnstile Secret Key, Supabase service-role key, passwords, or access tokens in Vite variables. Do not commit `.env.local` or upload it as part of `dist/`. Credential-pattern scanning is a useful check, not a proof that every arbitrary password string would be detected.

## Production preview on your Mac

With the existing working public values in `.env.local`, run:

```sh
npm ci
npm test
npm run build:pages
npm run preview:pages
```

Open **http://localhost:5173/** and **http://localhost:5173/#admin**. Keep the terminal open; stop another server on port 5173 first. The preview refuses to change ports so the existing localhost CORS and Turnstile settings remain valid. Press Control–C to stop it.

This tests the new root-path build without changing DNS or publishing. The real database is used unless `?preview=1` is added; use fictional requests and cancel/decline them afterward. A successful localhost test does not verify the new domain's DNS, certificate, allowlists, or a real CAPTCHA on that hostname.

## Settings to update later, after approval

- **GitHub Pages:** custom domain `pawsnextdoor.org`; Enforce HTTPS when the certificate is ready.
- **WordPress.com:** the apex GitHub Pages A records in [CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md); optional `www` CNAME to `ba-57.github.io`. Preserve unrelated email records and nameservers.
- **Supabase Auth:** Site URL `https://pawsnextdoor.org/`, with that exact Redirect URL added. Keep `http://localhost:5173/` and the old GitHub URL during transition. Existing verified admin accounts and admin membership remain unchanged; keep public signup disabled.
- **Supabase Edge Function Secrets:** add origin `https://pawsnextdoor.org` to `BOOKING_ALLOWED_ORIGINS` without a path or trailing slash; keep old trusted origins until the switch is stable.
- **Cloudflare Turnstile:** add hostname `pawsnextdoor.org` to the existing widget, preserving old/development hostnames. Keep the existing public and private key pair.

Email/password login uses `signInWithPassword` directly and does not require an OAuth redirect. The Auth URL settings establish the intended new website destination; they do not add password-reset or invitation handling to the app. Browser sessions are tied to the old origin, so sign in again on the new domain. This is not account or database loss.

## Approval, deployment and ongoing updates

After approving the domain switch, follow the coordinated order in [CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md): service allowlists, GitHub ownership/domain configuration, WordPress DNS, merge/deploy in the planned window, certificate/HTTPS, and live smoke tests. GitHub recommends configuring the custom domain before pointing DNS at it. Domain verification itself requires a TXT DNS record and has not been performed by this PR.

Merging to `main` starts the existing deployment workflow. If the domain setting is still the old GitHub hostname, the new guard stops deployment before the root artifact is uploaded/published. Do not bypass the guard. Changing the Pages domain setting itself may redirect the current GitHub URL, so coordinate it with the root build and DNS changes rather than doing it early.

After the switch, approved changes to `main` automatically test, build and deploy as before. If a workflow fails, inspect the failed step; do not revert to publishing raw Vite source. Missing variables are fixed in repository variables, domain-guard failures in Pages settings, and CAPTCHA/CORS failures in the respective hostname/origin allowlists.

Existing appointment records, availability, RLS policies, time zone, admin accounts, and Edge Function code are preserved. This PR does not apply a database migration, rotate keys, or change live external settings. Automatic customer email/text notifications remain outside the current implementation.
