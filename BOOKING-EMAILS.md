# Paws Next Door — automatic booking emails

## Current status

- GitHub draft PR #2 contains the proposed frontend changes, customer request receipts, administrator new-booking alerts, and customer approval/decline emails.
- The original request-walk function has already been deployed to Supabase with owner approval.
- The new review-walk function and frontend changes are **not deployed or published**. Approval/decline messages are therefore **not live**.
- Resend is configured with its test-only sender `onboarding@resend.dev`. Customer emails to addresses other than the account's verified recipient are intentionally disabled. A verified domain is necessary for general customer delivery.
- No long UUID reference number is shown in booking receipt emails or in the draft website interface. IDs remain in the database.

## Workflow

1. Customer requests a walk. Database saves a pending request and sends a receipt if the recipient is allowed by Resend. Administrator gets a new-request notification.
2. Administrator opens the dashboard and clicks **Approve walk** or **Decline request**. The new authenticated `review-walk` function validates the signed-in session and runs the existing admin-only database status RPC.
3. Only after a successful database state change, the function attempts to send the customer an approval or decline email.
4. The dashboard explicitly reports whether email was sent, unavailable, or suppressed by Resend test mode. The administrator should contact the customer directly if delivery is unavailable.
5. Cancellation retains the existing direct database update and manual customer contact; cancellation emails are not included in this change.

## Required secrets (Supabase Edge Functions)

- `RESEND_API_KEY`: private Resend API key
- `BOOKING_EMAIL_FROM`: `onboarding@resend.dev` while testing; replace with a verified sender to email actual customers
- `BOOKING_ADMIN_EMAIL`: email of the verified Resend account recipient
- Preserve `TURNSTILE_SECRET_KEY`, `BOOKING_ALLOWED_ORIGINS`, `SUPABASE_URL`, and server-managed Supabase keys.

No secret keys belong in GitHub, the Vite frontend, or screenshots.

## Release / validation checklist

1. Review [GitHub pull request #2](https://github.com/ba-57/dog-walking-website/pull/2), check CI tests and builds, and confirm interface wording.
2. Test customer receipt and administrator alert with a fictional booking at the *verified* account address; check Resend logs as well as the inbox.
3. Ask the owner to approve deploying **new** Supabase `review-walk` Edge Function separately. Its deployment affects the live backend, but the existing published website will not call it until the PR is merged.
4. Perform an authenticated end-to-end test for an approved and declined fictional booking. The service still must use test-recipient restrictions; arbitrary customer delivery is unavailable before domain verification.
5. Obtain approval before merging PR #2 into `main`; this merges and deploys the changed GitHub Pages frontend.
6. After email domain verification, repeat both status-email tests with a permitted real recipient before announcing production customer notification functionality.

## Security and reliability

The new review endpoint requires an authenticated user JWT (Supabase gateway verification), confirms the token with Supabase Auth, and relies on the existing database RPC to verify `admin_users` membership. It does not expose the service-role key to browsers. The outgoing email body escapes untrusted customer text and omits free-form notes.

Emails are best-effort, not guaranteed. Failed email delivery does not roll back a successful status change. Use the dashboard as the source of truth, monitor Resend delivery logs, and contact the neighbor manually when delivery fails. An eventual outbox/retry feature would improve delivery guarantees. The server performs status updates before email sends, so rejected duplicate transitions do not trigger extra emails.

## Rollback

Keep the live `request-walk` function as deployed until a separate approved update. To revert status emails, restore the prior frontend from GitHub and remove/disable the `review-walk` function; do not disable existing booking/CAPTCHA protections.
