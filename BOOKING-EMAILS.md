# Booking emails — PR #2 and approval-required release

## What is live, and what is only prepared

The website is live at **https://pawsnextdoor.org/**, with the same administrator accounts, Supabase database, Turnstile widget and root-path GitHub Pages build.

Read-only inspection during this task found:

- Supabase `request-walk` is **ACTIVE, version 7**. Its deployed source attempts a customer request receipt and a team new-request alert through Resend after saving a booking. Those deployed templates still contain database references and the old GitHub dashboard link.
- No `review-walk` Edge Function is deployed. Live approval/decline buttons use the original database RPC and do not send decision emails through the proposed function.
- The earlier draft notes recorded `onboarding@resend.dev` as the sender. Current secret values and the Resend account are not inspectable through the available connection, so that is historical configuration, not a verified statement of today's sender or delivery status.
- Public DNS returned no TXT at `resend._domainkey.pawsnextdoor.org`, and no TXT or MX at `send.pawsnextdoor.org`. A DMARC TXT record **is present**. These are common Resend record names; an account could use other selectors or a sending subdomain. Only Resend's dashboard can confirm the actual domain setup and verification status.

**Nothing was deployed, applied to the live database, merged, changed in DNS, or sent through Resend during this task.** Tests use fake data and mocked mail delivery. The migration below is a local proposal only. Removing references from the live request emails requires deploying the updated `request-walk` and its shared dependency after approval; a frontend merge alone cannot change already-deployed email templates.

## Prepared behavior

| Event            | Automatic initial notification                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| New walk request | Customer receipt stating the walk is **not yet confirmed**, plus a separate team alert linking to `https://pawsnextdoor.org/#admin` |
| Approved request | Customer approval with the walk's date/time and dog name                                                                            |
| Declined request | Customer decline with a link to request another time                                                                                |
| Cancellation     | Existing manual-contact workflow; no cancellation email in this scope                                                               |

No generated UUID/reference appears in the booking confirmation, rendered dashboard cards, or any of the four email bodies. IDs remain internal to database relationships, API calls, queue leases and the provider's idempotency header.

A new private email outbox is written **in the same transaction** as a new booking or review decision. The old RPCs remain compatible: new functions opt into the wrappers, so installing the migration does not enqueue historical mail or duplicate emails from the old deployed request handler. Each event is unique per appointment. Payload snapshots omit free-form notes and are deleted if the appointment is deleted.

After commit, the server attempts delivery. The request handler uses the Edge runtime's background task support when available; a mail outage cannot turn a saved booking into a failed booking response. Approval/decline responses likewise distinguish a committed status from email failure. Failed or interrupted jobs remain visible to administrators, with **Retry emails** available without repeating the booking or review transition.

**Retries are admin-triggered, not a scheduled background service.** No cron job, automated resend sweep, or mass backfill is configured. Job leases prevent concurrent claims, accepted events are not re-sent, and stable Resend idempotency keys protect retries. Resend retains these keys for 24 hours, so the queue stops automatic/manual-button attempts after 23 hours from the first attempt or five attempts, and shows **Manual review needed** instead. A stale receipt after a decision, a receipt/approval for a past walking time, or an unaccepted approval after cancellation is marked obsolete. Do not bypass these limits blindly.

**Accepted by email provider is not Delivered.** SMTP bounces, complaints and inbox placement are checked in Resend's logs, not inferred from its HTTP acceptance. This PR does not install delivery webhooks or automatically retry bounces. If a result is ambiguous, inspect Resend logs before changing the sender/template or deciding on manual contact. No implementation can promise exactly-once inbox delivery.

## 1. Verify the sending domain in Resend — manual, after DNS approval

Owning `pawsnextdoor.org`, serving the website on GitHub, and configuring Turnstile do **not** authorize Resend to send email from this domain.

1. Open the existing Resend account → **Domains**. Look for `pawsnextdoor.org`. If it is absent, add that domain and select your intended Resend sending region. If a dedicated sending subdomain was deliberately chosen instead, use its exact records and a matching From address throughout.
2. Copy Resend's **exact DNS record names, values and priorities**. The DKIM value is unique, and the return-path MX target depends on Resend's region; do not infer it from your Supabase region or copy a generic example.
3. After DNS changes are approved, open WordPress.com → **Domains → pawsnextdoor.org → DNS records / Manage DNS**, or your actual authoritative DNS provider if different. Add only the records shown by Resend:

   | Purpose                     | Typical type/name for a root sending domain | Value                                                                                  |
   | --------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
   | DKIM signing                | TXT, commonly `resend._domainkey`           | The unique public DKIM value supplied by Resend                                        |
   | SPF for the return path     | TXT, commonly `send`                        | Resend's exact SPF text for that hostname                                              |
   | Return-path/bounce handling | MX, commonly `send`                         | Resend's exact region-specific feedback server and priority                            |
   | DMARC                       | TXT `_dmarc`                                | Already present; preserve/review the existing policy instead of adding a second record |

4. If WordPress appends `.pawsnextdoor.org` automatically, enter only the relative name (`send`, `resend._domainkey`). Check the final full hostname before saving. Use Resend's displayed names if they differ from these common defaults.
5. Preserve the GitHub website A/AAAA/CNAME records, ownership TXT records, existing mailbox MX records, and other SPF/DKIM records. Avoid duplicate SPF or DMARC records at the same hostname. Resend's `send` MX record is **not** a request to replace your apex inbox-provider MX records. Do not enable Resend receiving unless you separately intend to use it.
6. Back in Resend, click **Verify** or **Restart verification** and wait until the domain's required sending checks show **Verified**. Public DNS presence alone does not prove account verification, correct values, or authorization of the API key.
7. Check that the existing API key has sending permission for this domain. Keep it private; use a sending-only/domain-restricted key where available. If a key needs changing, enter it only in Supabase Edge Function Secrets, never in GitHub/Vite or chat.

A From address such as `Paws Next Door <walks@pawsnextdoor.org>` does not automatically create a mailbox. Choose a real, monitored Reply-To address (an existing team inbox is fine). Website DNS, outbound mail verification and receiving customer replies are separate configurations.

## 2. Supabase Edge Function secrets — manual, after configuration approval

Use **Supabase → Edge Functions → Secrets**. Do not share secret values in chat.

| Name                     | Purpose                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`         | Existing private Resend sending key with permission for the verified domain                                                                                                                                                 |
| `BOOKING_EMAIL_FROM`     | A verified sender, e.g. `Paws Next Door <walks@pawsnextdoor.org>`. During sandbox tests, `onboarding@resend.dev` is allowed only with restricted test mode.                                                                 |
| `BOOKING_ADMIN_EMAIL`    | The real team inbox that should receive new-request alerts                                                                                                                                                                  |
| `BOOKING_EMAIL_REPLY_TO` | Optional monitored reply address; defaults to `BOOKING_ADMIN_EMAIL`                                                                                                                                                         |
| `BOOKING_EMAIL_MODE`     | `test` initially. Omitting it also defaults to test mode. Change to `production` only after domain verification, controlled testing and explicit approval for customer email.                                               |
| `BOOKING_TEST_RECIPIENT` | In test mode, the **single explicitly allowed** owned test inbox. For `onboarding@resend.dev`, this must be the actual address Resend allows for that account. Do not assume the admin inbox is automatically that address. |

Test mode filters **both** customer and team email recipients. Other recipients are held as **Restricted test mode**, not silently rerouted. The From, reply address and test recipient are validated against header-injection characters. Production mode rejects any `@resend.dev` From address. Missing/invalid configuration leaves notifications queued without attempting an email.

Preserve `TURNSTILE_SECRET_KEY`, `BOOKING_ALLOWED_ORIGINS` (including `https://pawsnextdoor.org`), the project URL and server-managed service-role credentials. No changes to frontend public keys, the domain, administrator accounts, Auth URL settings, or database booking constraints are required. Booking emails use Resend's HTTPS API; Supabase Auth SMTP/password-reset configuration is a separate feature and is not changed here.

## 3. Release order — each live change requires approval

Do not merge this PR first: the new frontend depends on the queue table and `review-walk` endpoint.

1. Review PR #2 and its passing checks. Confirm the sender identity, monitored inbox, test recipient and Resend verification status. **Obtain approval before changing secrets or DNS.** Domain records can be prepared separately; keep mail mode `test` until explicitly approved otherwise.
2. **Obtain approval before applying** `supabase/migrations/20261122214819_booking_email_outbox.sql` to the existing project. Apply only this new migration once; do not rerun the original booking migration. It adds a protected queue and RPC wrappers without changing existing appointment IDs/data or backfilling any email.
3. **Obtain approval before deploying both functions** from this exact branch commit. The existing `request-walk` must be updated to use the queued path and UUID-free templates; the new `review-walk` must also be deployed. Include all relative `_shared` dependencies. Do not deploy the old draft's review handler with the new migration/frontend, or a mismatched booking-emails helper.

   ```sh
   supabase functions deploy request-walk --project-ref sfwpwzzbqnfdqnaciffk
   supabase functions deploy review-walk --project-ref sfwpwzzbqnfdqnaciffk
   ```

   These are future commands, not actions run during this task. `request-walk` keeps `verify_jwt=false` and server-side Turnstile verification. `review-walk` keeps `verify_jwt=true`, confirms the real session with Auth, checks admin membership, and calls the user-authorized review RPC. Worker/PII functions accept only service-role execution. CORS preflight does not grant mutation permission.

4. **Obtain approval to send controlled test emails** to an owned inbox. Test through a local checkout of this branch first, with the existing public `.env.local` values and `BOOKING_EMAIL_MODE=test`. The currently published frontend does not call `review-walk` yet.
5. Only after the backend and controlled tests pass, request approval to merge PR #2. Merging publishes the frontend through the existing main-only Pages workflow at `https://pawsnextdoor.org/`; root base, `public/CNAME`, domain guard, Turnstile and private admin dashboard are preserved.
6. Only after verified sending and explicit authorization for real customer notifications, set `BOOKING_EMAIL_MODE=production`. Confirm any held jobs before using **Retry emails**; releasing test-suppressed jobs can email their original recipients. Do not bulk-release an unreviewed queue. Old accepted messages are never retried, and no historical requests were backfilled.

## 4. Controlled delivery test — not performed yet

Use fictional names/dog information with your real, owned and approved test inbox; an `example.test` address cannot demonstrate actual inbox delivery. Keep general customer sending disabled.

- Set the test recipient to your owned inbox. To exercise all four messages, set the team alert inbox to that same approved inbox during testing (or use production verified sending only after separately approved).
- Create **two** different future walking times. Submit test request A and check both its receipt and team alert in Resend's logs and the inbox. The receipt must say pending/not confirmed, show a human-readable time in the service timezone, use `pawsnextdoor.org`, and contain no database reference.
- Approve A through this branch's local admin dashboard. Confirm exactly one approval is accepted and delivered. Refresh/retry and verify no duplicate accepted message is sent.
- Submit request B, then decline it. Check receipt, team alert and one decline email. A cannot be approved and declined in succession; the existing transition rules deliberately forbid that. Keep the existing three-requests-per-email-per-day limit in mind.
- Test with a different fictional customer email while still in test mode: the request is saved, but email is held and the dashboard says Restricted test mode. Do not use a real unsuspecting customer address.
- Provider-failure and crash/retry conditions are covered by mocked tests. If performing a live failure test later, coordinate it so it does not interrupt genuine bookings; do not deliberately invalidate production credentials during normal service.
- Check **Resend → Emails/Logs** for **Delivered**, not merely an API message ID or Accepted. Inspect bounces, spam/junk and Reply-To behavior. Use **Retry emails** only for queued/failed test jobs; a stalled processing lease becomes eligible after two minutes. After five attempts or 23 hours, reconcile logs and contact the recipient manually rather than forcing a fresh key.
- Cancel/decline remaining test bookings as appropriate. Cancellation still requires direct customer contact. Delete test data only through the normal authorized retention process; deleting an appointment cascades its private email payloads.

## Reliability, privacy and rollback

The queue is private and protected by RLS. Administrators can read only status metadata, not raw queued payloads or lease tokens. Non-admin users cannot read queue rows or invoke mail-worker RPCs. Authenticated retries recheck admin membership, never repeat the booking/status update, and return only a delivery summary. No provider response body, recipient, customer note, token or private key is logged or sent to the public booking response. HTML escapes untrusted names/details. Notes are never copied into notifications.

Preserve the deployed function source/version and database backup before a later approved release. To roll back the frontend, use the prior reviewed main version. To roll back functions, restore compatible prior sources; keep the queue data for reconciliation. The old booking/review RPCs remain present and compatible, so applying this migration alone does not change today's live frontend/function behavior. Do not drop tables or resend historical messages as a rollback shortcut.

References: [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Resend email API](https://resend.com/docs/api-reference/emails/send-email), [WordPress DNS management](https://wordpress.com/support/domains/custom-dns/). Read-only DNS observations are not a substitute for your Resend account's Verified status.
