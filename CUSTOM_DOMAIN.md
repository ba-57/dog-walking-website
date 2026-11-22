# Custom-domain switch: pawsnextdoor.org

**Domain switch completed according to the owner.** The site is now live at https://pawsnextdoor.org/. Keep this document as the original switch/settings reference. Do not repeat DNS or Pages changes for the email PR; its additional sending-domain records are described in [BOOKING-EMAILS.md](BOOKING-EMAILS.md).

- Original GitHub address: **https://ba-57.github.io/dog-walking-website/**
- Current site: **https://pawsnextdoor.org/**
- Current admin sign-in: **https://pawsnextdoor.org/#admin**

The same GitHub repository, Supabase project, database, administrator accounts, Edge Function, and Turnstile widget will be used. No database migration, data copy, account recreation, or secret rotation is required. Expect to sign in again on the new domain because browser sessions belong to their original origin.

## Concise settings checklist for the approved switch

| Service                        | Setting to update later                                                                                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Pages                   | Keep Source **GitHub Actions**. Set **Custom domain** to `pawsnextdoor.org`, save, and enable **Enforce HTTPS** once GitHub provisions the certificate.                                                                       |
| WordPress.com DNS              | Point apex `@` to the four GitHub Pages A addresses below. Replace conflicting apex website records; preserve email MX/TXT records. No nameserver change is needed if WordPress.com currently hosts the DNS.                  |
| Supabase Auth                  | Set **Site URL** to `https://pawsnextdoor.org/`. Add that exact URL to **Redirect URLs**; retain the old GitHub URL and `http://localhost:5173/` during transition. Keep existing admin accounts and email/password settings. |
| Supabase Edge Function Secrets | Add `https://pawsnextdoor.org` to `BOOKING_ALLOWED_ORIGINS`, preserving the old GitHub origin and localhost. Do not include a path or trailing slash.                                                                         |
| Cloudflare Turnstile           | Add the hostname `pawsnextdoor.org` to the existing widget. Retain `ba-57.github.io` and `localhost` during transition. Keep the same public Site Key and server-only Secret Key.                                             |
| GitHub public build variables  | Keep the existing `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_TURNSTILE_SITE_KEY`. Their values do not change just because the frontend domain changes.                                                   |

The Supabase URL stays `https://sfwpwzzbqnfdqnaciffk.supabase.co`; the new website URL does not replace it. `.env.local` stays out of Git. Server credentials stay in Supabase, never in the Vite build.

## What this pull request prepares

- `npm run build:pages` forces Vite's production base to `/`, even if an old local environment still contains `/dog-walking-website/`.
- `public/CNAME` contains only `pawsnextdoor.org`. Vite copies it to `dist/CNAME`; the release checker verifies that exact content along with root asset paths and credential checks.
- GitHub Actions uploads only the checked `dist/` artifact. Review-branch checks do not deploy. The deployment remains restricted to `main` and additionally refuses to publish unless the Pages action reports hostname `pawsnextdoor.org`.
- **A CNAME file does not configure a custom domain for an Actions-based Pages site.** GitHub ignores that file for its domain setting. It records the intended domain in the repository/artifact; the Pages **Custom domain** setting must still be changed separately, at the approved time.
- The booking UI, Supabase Auth client, row-level security, database functions, and Turnstile-verifying Edge Function are unchanged.

## Coordinated cutover — only after approval

A root-path build and the Pages domain setting must be switched together. Do not merge this PR as a standalone routine deployment while the site is still configured for the project URL. The deployment guard stops that mismatch, but cannot coordinate DNS or eliminate propagation delays. Plan a short switch window and keep the current `main` revision recorded for rollback.

1. **Prepare service allowlists.** In Supabase, add the new Auth redirect URL and the new booking origin. In the existing Cloudflare Turnstile widget, add `pawsnextdoor.org`. Keep old entries so the current site can continue working. Set Auth's Site URL to the new address as part of the switch. Do not change the Supabase project, database, administrator membership, keys, or Edge Function code.
2. **Verify domain ownership with GitHub.** In your GitHub account's **Settings → Pages → Add a domain**, follow the generated TXT verification instructions if needed. Add only GitHub's exact generated TXT name/value in your DNS manager and complete verification. This is a DNS change and must wait for approval too. Do not guess the verification value.
3. **Configure the repository first.** Open **Repository → Settings → Pages**. Keep **Source: GitHub Actions**. Enter `pawsnextdoor.org` under **Custom domain** and save. GitHub recommends adding the custom domain here before pointing DNS at GitHub. A pending DNS check is expected until the DNS step is complete.
4. **Update WordPress.com DNS.** Use the instructions below. Do not buy WordPress hosting, connect the domain to a WordPress-built site, or use domain forwarding for this GitHub-hosted site.
5. **Merge and deploy in the same planned window.** Merge the approved custom-domain PR into `main`; this starts the existing Pages deployment workflow. Its guard checks the configured Pages hostname before upload/deployment. Wait for the workflow to succeed. Do not run a production deployment while this PR remains unapproved.
6. **Finish HTTPS.** Wait for DNS verification and GitHub's TLS certificate to become available, then enable **Enforce HTTPS** in Pages settings. DNS and certificate provisioning can take time; do not repeatedly change settings while they propagate. Check HTTPS at the apex before testing logins or bookings.
7. **Verify the real domain.** Follow the smoke checks below. Keep the old allowlist entries until the switch is stable and rollback is no longer needed. Check how the old GitHub URL redirects; do not assume every old project-path link is preserved automatically.

No part of this sequence has been executed by preparing this PR. Changing the Pages custom domain can redirect the existing GitHub URL before all other pieces are ready, so do not make that change in advance of the coordinated window.

## WordPress.com DNS details

If the domain uses WordPress.com's nameservers, open your WordPress.com account → **Domains** → **pawsnextdoor.org** → **DNS records** (sometimes **Manage DNS**). If DNS is managed elsewhere, make these changes at the current authoritative DNS provider instead. Buying the domain at WordPress.com does not always mean its active DNS zone is there.

Create these apex records. WordPress may show a blank root/name field instead of `@`; both indicate the bare domain:

| Type | Host/name | Points to/value   |
| ---- | --------- | ----------------- |
| A    | `@`       | `185.199.108.153` |
| A    | `@`       | `185.199.109.153` |
| A    | `@`       | `185.199.110.153` |
| A    | `@`       | `185.199.111.153` |

Replace any conflicting WordPress/default **apex A** records rather than leaving them alongside GitHub's addresses. If apex **AAAA** records point elsewhere, remove or replace only those website records; otherwise IPv6 visitors could reach the wrong host. IPv6 is optional. If you use it, GitHub's addresses are `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, and `2606:50c0:8003::153` (one AAAA record each), alongside the A records.

Optional `www` alias:

| Type  | Host/name | Points to/value   |
| ----- | --------- | ----------------- |
| CNAME | `www`     | `ba-57.github.io` |

The DNS CNAME target is **`ba-57.github.io`**, not `pawsnextdoor.org`, a URL with `https://`, or a repository path. This DNS record is separate from the repository's `public/CNAME` file. GitHub can redirect `www` to the configured apex domain when both are correctly configured; verify HTTPS and that redirect before sharing `www`. The requested application URL is the apex. If you intentionally serve the app directly on `www` instead of redirecting it, that additional origin/hostname must also be added to Supabase and Turnstile.

Keep default TTL unless you have a reason to change it. Preserve MX, email-related TXT records (SPF/DKIM/DMARC), GitHub verification TXT records, and other unrelated service records. Do not add a wildcard record, and do not change nameservers as part of these record edits.

## Supabase and Cloudflare values

Future Auth Site URL and new Redirect URL:

```text
https://pawsnextdoor.org/
```

Example booking origin list during transition:

```text
http://localhost:5173,https://ba-57.github.io,https://pawsnextdoor.org
```

Add any other existing trusted origins you still need rather than replacing them blindly. This is `BOOKING_ALLOWED_ORIGINS` under **Supabase → Edge Functions → Secrets**. Keep `TURNSTILE_SECRET_KEY` and Supabase's service-role key server-side.

In **Cloudflare → Turnstile → existing widget → Settings → Hostname Management**, add **`pawsnextdoor.org`** without a scheme, slash or path. A WordPress-hosted domain can use Turnstile without moving its DNS to Cloudflare. Use the same widget and key pair; local and old-domain hostnames can remain allowed.

Password login still uses `signInWithPassword` directly. Auth Site URL/redirect settings are not a new login implementation, and this change does not add password-reset handling or a new signup flow. Keep the current signup restriction and admin authorization.

## Smoke checks after the approved switch

1. Open `https://pawsnextdoor.org/`: confirm the design, image, styles and calendar load, with no old `/dog-walking-website/assets/` requests or mixed HTTP content.
2. Open `https://pawsnextdoor.org/#admin`: sign in with the existing administrator account. Verify existing requests and availability remain visible. A fresh login on the new origin is normal.
3. Add a future 30-minute test slot, then use a private browser window and fictional customer details to submit through the real Turnstile widget. Do not use `?preview=1` for this database test.
4. Confirm the request appears once, holds the time, and can be approved/declined. Decline or cancel test appointments afterward. Check that date blocking and public privacy still behave correctly.
5. Test Safari and a phone. Confirm the old URL's redirect and optional `www` redirect. Watch for CAPTCHA hostname errors or CORS errors; these indicate missing settings, not a need to recreate the database.

Tests in this PR validate the root build, CNAME, frontend behavior and PostgreSQL permissions locally. The new domain's DNS, certificate, live Auth and successful real CAPTCHA cannot be fully verified before the approved domain switch.

Official references: [GitHub custom domains and DNS](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), [GitHub domain verification](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages), [WordPress.com DNS records](https://wordpress.com/support/domains/custom-dns/), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/).
