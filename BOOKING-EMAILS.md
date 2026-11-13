# Automatic booking emails — approval checklist

This feature is staged in a GitHub pull request. **Do not merge or deploy the Supabase function until approved.** The live site and backend retain their existing behavior.

## What it sends

After a booking request is successfully saved by the existing CAPTCHA-verified \`request-walk\` Edge Function:

1. The customer receives a **request-received receipt**, including dog name, requested time, reference number, and a prominent warning that the walk **is not approved yet**.
2. The service owner receives a **new request alert**, including the customer's contact information, dog name, neighborhood, requested time, and a link to the private dashboard.

Email messages deliberately exclude the free-form notes field to minimize disclosure of customer data. Emails are sent from the trusted server, never the public browser. No credentials are committed to GitHub.

**Important:** These are receipt/alert messages, not an approval email. Approval, rejection, and cancellation still require the existing manual customer follow-up. Because sending is best-effort, a successfully saved request stays saved if email delivery fails; the dashboard remains the source of truth.

## Owner setup required before enabling delivery

Recommended provider: [Resend](https://resend.com/). Create a Resend account, verify a domain you control under **Domains**, and create a restricted sending API key under **API Keys**. Resend may permit testing only with an approved recipient until domain verification is finished.

Under [Supabase → Edge Functions → Secrets](https://supabase.com/dashboard/project/sfwpwzzbqnfdqnaciffk/functions/secrets), configure:

| Secret | Example / purpose |
| --- | --- |
| \`RESEND_API_KEY\` | Your private Resend sending API key. Never paste into GitHub or chat. |
| \`BOOKING_EMAIL_FROM\` | \`Paws Next Door <walks@YOUR-VERIFIED-DOMAIN>\` |
| \`BOOKING_ADMIN_EMAIL\` | The email address that should receive owner alerts. |

Retain existing \`TURNSTILE_SECRET_KEY\`, \`BOOKING_ALLOWED_ORIGINS\`, \`SUPABASE_URL\` and \`SUPABASE_SERVICE_ROLE_KEY\` settings.

## Tests and activation

1. In the GitHub pull request, check **Review checks**. These run \`npm test\` and the production build without publishing.
2. Confirm the sender domain is verified at Resend and the three Supabase secrets are configured. Do not enter credentials into the website's \`VITE_*\` variables.
3. Obtain owner approval to **deploy** the updated \`request-walk\` Edge Function (including its two shared JavaScript dependencies) to project \`sfwpwzzbqnfdqnaciffk\`. **Deploying a function changes the currently live backend immediately, even if the GitHub PR is not merged.** This is a separate approval step from merging the PR.
4. After approval, use a controlled test appointment with fictional data and authorized test email inboxes to confirm **both** messages arrive and show the correct timezone. Inspect the request in the admin dashboard; decline/cancel the test afterward. Verify that a rejected/duplicate booking does not send an email.
5. Once the owner approves publishing any accompanying website copy/documentation changes, merge the PR into \`main\`. This triggers the GitHub Pages deployment workflow.

**Rollback:** redeploy the previously deployed \`request-walk\` handler (from \`main\` prior to merging the PR), or disable sending by removing the mail secrets. Never remove the Turnstile or origin checks.

## Limitations

The email provider accepting a message is not proof of inbox delivery. Monitor Resend delivery/bounce logs. Sending after the save is best-effort rather than a durable queue, so transient provider errors may result in a saved booking without an email. Do not interpret such an email failure as permission to resubmit a booking. If guaranteed eventual delivery is needed, plan a database outbox with retry controls as a separate feature.
