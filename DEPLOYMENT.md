# Publish Paws Next Door with GitHub Pages

The frontend is prepared for **https://ba-57.github.io/dog-walking-website/**. Administrator login is **https://ba-57.github.io/dog-walking-website/#admin**. The project path ends with `/`; `#admin` is an in-page route, so no additional HTML page or server rewrite is required.

These instructions do not themselves publish the website. The redesigned frontend stays on `feat/community-booking` until you approve and merge its pull request. The existing Supabase backend is separate from GitHub Pages and is already deployed.

## What the workflows do

- **Review checks** runs on pull requests into `main` and pushes to `feat/community-booking`. It tests the app, builds the setup-pending variant, then builds and verifies the real Pages variant using repository variables. It uploads `dist/` as a review artifact. It has no deployment permissions and cannot publish.
- **Deploy Paws Next Door to GitHub Pages** runs on pushes to `main`, including an approved pull request merge. A manual run is also available on `main`. Both jobs explicitly reject other branches and other repositories. It tests, builds, checks the artifact, uploads only `dist/`, and deploys through the official Pages action.
- Only the deployment job receives `pages: write` and `id-token: write`. Other jobs use read-only repository access. Actions are pinned to verified release commit hashes.
- Production builds stop if public configuration is missing or contains a placeholder, private/legacy key, or test CAPTCHA site key. `npm run build:pages` always uses `/dog-walking-website/`, even if `.env.local` uses `/` for local development.
- The build checks generated asset paths/files, confirms the three public configuration values were embedded, rejects environment files and server-only configuration in the output, and scans Git source and output for recognizable private credentials. This scan complements code review; it cannot prove the absence of every arbitrary password string.
- `.env.local` remains ignored. Neither workflow uploads repository source, local environment files, Supabase function source, or database records as the deployed website.

## 1. Configure GitHub's three public repository variables

These are intentionally public browser settings. They belong under **Variables**, not a committed environment file. There are no frontend service-role or Turnstile secret credentials.

1. Open **https://github.com/ba-57/dog-walking-website/settings/variables/actions**.
2. Under **Repository variables**, click **New repository variable** for each name below. If a variable already exists, edit it instead.
3. Copy each value from your working local `.env.local`. Copy only the part after `=`; do not include quotes, surrounding spaces or a newline.

| Variable name                   | Value                                                   |
| ------------------------------- | ------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://sfwpwzzbqnfdqnaciffk.supabase.co`              |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The working public key beginning with `sb_publishable_` |
| `VITE_TURNSTILE_SITE_KEY`       | The working public Turnstile Site Key                   |

The workflow sets the base path itself. You do not need a fourth repository variable. Changing a variable requires another build; it does not update an already-published bundle automatically.

If Codex has functioning GitHub access, it can populate and verify these variables for you using the local configuration without printing their values. Do not send private credentials in chat. If a review check fails because a variable is missing, finish this step and rerun that failed check from the pull request's Checks tab.

## 2. Check Supabase Auth

Open **https://supabase.com/dashboard/project/sfwpwzzbqnfdqnaciffk/auth/url-configuration**.

1. Set **Site URL** to:

   ```text
   https://ba-57.github.io/dog-walking-website/
   ```

2. In **Redirect URLs**, retain your local development entry and add the exact production URL. The entries should include:

   ```text
   http://localhost:5173/
   https://ba-57.github.io/dog-walking-website/
   ```

3. Save the changes. Avoid broad wildcard entries for production.
4. Open **Authentication → Sign In / Providers** (or Authentication settings, depending on the dashboard layout). Email/password sign-in must remain enabled. Turn **Allow new users to sign up** off because this dashboard uses administrator accounts created by the owner. Existing accounts can still sign in.

At preparation time, the public Auth API confirmed email sign-in was enabled, but **public signup was still enabled**. It does not expose the Site URL or redirect list, so those two settings require verification in the dashboard. Admin membership checks and RLS still prevent newly signed-up, non-admin accounts from seeing appointments.

The current login uses `signInWithPassword`, which returns a session directly and does not navigate through an OAuth redirect. Changing the base path does not change that flow. Site URL and Redirect URLs set the intended destinations for Auth emails/future flows; they do not add password-reset or invitation handling to the app. Recovery remains managed through trusted Supabase administration.

Supabase's security advisor also reported leaked-password protection disabled. If your plan supports it, enable it under Auth password security. The app's owner-only admin membership table intentionally has no public RLS policy; its public calendar RPC deliberately returns only safe availability data. Admin RPCs check membership inside each function.

## 3. Check the booking origin and Turnstile hostname

The origin and the hostname are different settings:

| Setting                                  | Production value                               |
| ---------------------------------------- | ---------------------------------------------- |
| Supabase `BOOKING_ALLOWED_ORIGINS` entry | `https://ba-57.github.io`                      |
| Cloudflare Turnstile allowed hostname    | `ba-57.github.io`                              |
| Website's full URL                       | `https://ba-57.github.io/dog-walking-website/` |

**Supabase:** At preparation time, a real CORS preflight from `https://ba-57.github.io` succeeded. A booking without a CAPTCHA was rejected. The public calendar responded in `America/Chicago`, and anonymous access to appointment records and direct booking RPC submission was denied. No appointments were written by these checks.

If you need to edit the origin list, open **Supabase → Edge Functions → Secrets**, edit `BOOKING_ALLOWED_ORIGINS`, and ensure it includes:

```text
http://localhost:5173,https://ba-57.github.io
```

Keep any other explicitly trusted origins you still need. Do not put `/dog-walking-website/` in this setting. Do not change `TURNSTILE_SECRET_KEY`; it stays server-side.

**Cloudflare:** Its account settings could not be inspected from this workspace, so verify them manually:

1. Open Cloudflare → **Turnstile**.
2. Select the Paws Next Door widget matching your public Site Key.
3. Open **Settings → Hostname Management** (sometimes labeled Hostnames).
4. Ensure `ba-57.github.io` is listed. Keep `localhost` for local testing.
5. Save if you changed anything. Do not include a scheme, path or port in the hostname list.

The frontend requests Turnstile action `walk_request`. The Edge Function checks that action, a successful verification, and the token hostname against the allowed request origin. Local testing proves the widget's local flow; a successful CAPTCHA on the published hostname must still be tested after launch.

## 4. Review the production build before approving

In your local project folder, with your working `.env.local`:

```sh
npm ci
npm test
npm run build:pages
npm run preview:pages
```

Keep the preview terminal open and visit:

```text
http://localhost:5173/dog-walking-website/
```

Use **http://localhost:5173/dog-walking-website/#admin** for login. Do not add `?preview=1` when testing the actual database. Stop another server on port 5173 before running this preview; the command deliberately refuses to switch ports so that CORS and Turnstile settings stay consistent. Press Control–C to stop the preview.

`npm run build:pages` does not edit `.env.local`. The local dev server still uses `/`. `npm run preview:pages` serves the production build at the actual project path, using localhost as the browser origin.

The original end-to-end local checks (login, availability, CAPTCHA, submission, approve/decline) were completed by the owner. The automated production checks verify compilation, asset paths, public configuration, constraints, permissions and safe failure paths. They cannot log in as the owner, solve a real CAPTCHA, or fully verify an as-yet-unpublished production website. Do not interpret a successful build as a completed live browser test.

## 5. Approve and publish, only when ready

Do not perform this section until you have approved publication. Merging the pull request after these settings are in place is the action that starts the automatic deployment.

1. Open **https://github.com/ba-57/dog-walking-website/pull/1**. Review **Files changed** and confirm the latest **Review checks** passed.
2. After deciding to publish, open **Repository Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Changing this source is intentionally left to you for launch; Codex has not changed the current live hosting source. Existing content should remain served until a deployment succeeds, but avoid unrelated Pages changes.
3. Return to the pull request. Click **Ready for review** if it is still a draft. For a pull request you authored, GitHub will not let you approve your own review; you can review it yourself and merge when satisfied, or ask a collaborator to approve it.
4. Click **Merge pull request** (or **Squash and merge**), then confirm. This is your publication approval. Do not enable automatic merging before you are ready.
5. Open the repository's **Actions** tab and select **Deploy Paws Next Door to GitHub Pages**. Wait until both build and deploy succeed. If the `github-pages` environment requires a deployment review, use **Review deployments** only when you are ready to publish.
6. Open **https://ba-57.github.io/dog-walking-website/** and hard-refresh Safari with Command–Option–R. The admin URL ends in `/#admin`.
7. Complete one fictional booking on the production hostname, confirm its pending status in the admin dashboard, then decline/cancel it after testing. Check the phone layout too. Appointments and admin sessions are stored through Supabase, not GitHub Pages. No automatic customer emails/texts are sent.

The manual workflow button must also be run from `main`; runs from the feature branch are skipped. After the initial release, approved pushes to `main` automatically rebuild and redeploy. Do not push unreviewed changes to `main`.

If the workflow fails, the previous deployed site stays in place. Inspect the failed step rather than changing to raw-source branch publishing. A missing variable is fixed in Repository variables; a permissions/source error is checked in Pages settings; a CAPTCHA hostname error is fixed in Cloudflare.
