// Server-only transactional booking emails. No browser credential or customer data is logged.
const emailSafe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function formattedWalk(startsAt, timezone) {
  if (!startsAt) return "The walking time shown in your request";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/Chicago",
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(startsAt));
  } catch {
    return "The walking time shown in your request";
  }
}

export function bookingEmails({ id, fields, startsAt, timezone, adminEmail }) {
  const date = formattedWalk(startsAt, timezone);
  const reference = String(id);
  const customer = [
    "Hi " + fields.p_customer_name + ",",
    "",
    "We received your Paws Next Door dog-walking request.",
    "Dog: " + fields.p_dog_name,
    "Requested walk: " + date,
    "Reference: " + reference,
    "",
    "Your requested time is being held while our team reviews it. This is NOT a confirmed walk yet.",
    "We will contact you separately after reviewing the request. Please wait for approval before making arrangements.",
    "",
    "Thank you,",
    "Paws Next Door",
  ].join("\n");
  const admin = [
    "A new Paws Next Door walk request needs review.",
    "",
    "Name: " + fields.p_customer_name,
    "Email: " + fields.p_email,
    "Phone: " + fields.p_phone,
    "Dog: " + fields.p_dog_name,
    "Neighborhood: " + fields.p_neighborhood,
    "Requested walk: " + date,
    "Reference: " + reference,
    "",
    "Review the pending request at:",
    "https://ba-57.github.io/dog-walking-website/#admin",
    "",
    "The customer has only received a request receipt, not walk approval.",
  ].join("\n");
  const toHtml = (text) => '<div style="font:16px/1.5 Arial,sans-serif;white-space:pre-line">' + emailSafe(text) + "</div>";
  return [
    { to: [fields.p_email], subject: "Paws Next Door — we received your walk request", text: customer, html: toHtml(customer) },
    { to: [adminEmail], subject: "Paws Next Door — new walk request to review", text: admin, html: toHtml(admin) },
  ];
}

export async function notifyBooking({ env, fetchImpl, id, fields }) {
  const key = env.get("RESEND_API_KEY");
  const from = env.get("BOOKING_EMAIL_FROM");
  const adminEmail = env.get("BOOKING_ADMIN_EMAIL");
  // Never block a successfully saved booking on missing mail configuration.
  if (!key || !from || !adminEmail) return { configured: false };

  let startsAt = null;
  let timezone = "America/Chicago";
  const url = env.get("SUPABASE_URL");
  const serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (url && serviceKey) {
    const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
    try {
      const [slot, settings] = await Promise.all([
        fetchImpl(url + "/rest/v1/walk_slots?id=eq." + encodeURIComponent(fields.p_slot_id) + "&select=starts_at", {
          headers, signal: AbortSignal.timeout(5000),
        }),
        fetchImpl(url + "/rest/v1/service_settings?id=eq.true&select=timezone", {
          headers, signal: AbortSignal.timeout(5000),
        }),
      ]);
      if (slot.ok) startsAt = (await slot.json())[0]?.starts_at ?? null;
      if (settings.ok) timezone = (await settings.json())[0]?.timezone || timezone;
    } catch {
      // Booking succeeds even when the optional timing lookup is unavailable.
    }
  }

  const emails = bookingEmails({ id, fields, startsAt, timezone, adminEmail });
  // Resend's unverified test sender is restricted to the account's verified address.
  // Do not attempt customer delivery to other addresses in this testing mode.
  const isTestSender = /(?:^|<)onboarding@resend\.dev>?$/i.test(from.trim());
  const deliverable = isTestSender
    ? emails.filter((email) => email.to[0].toLowerCase() === adminEmail.toLowerCase())
    : emails;
  const results = await Promise.allSettled(deliverable.map(async (email) => {
    const result = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, ...email }),
      signal: AbortSignal.timeout(8000),
    });
    if (!result.ok) throw new Error("Email provider rejected notification");
    return true;
  }));
  // Do not log recipient addresses, message bodies, keys or email API responses.
  return { configured: true, sent: results.filter((r) => r.status === "fulfilled").length };
}
