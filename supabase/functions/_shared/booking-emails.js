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
  const customer = [
    "Hi " + fields.p_customer_name + ",",
    "",
    "We received your Paws Next Door dog-walking request.",
    "Dog: " + fields.p_dog_name,
    "Requested walk: " + date,
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


// Approval and decline messages are sent only after authenticated admin review succeeds.
export function reviewEmail({ appointment, status, startsAt, timezone }) {
  if (!["approved", "declined"].includes(status)) throw Error("Unsupported notification status");
  const date = formattedWalk(startsAt, timezone);
  const approved = status === "approved";
  const content = [
    "Hi " + appointment.customer_name + ",",
    "",
    approved
      ? "Good news! Your Paws Next Door dog-walking request has been approved."
      : "We're sorry, but we can't accommodate your Paws Next Door walk request this time.",
    "",
    "Dog: " + appointment.dog_name,
    "Requested time: " + date,
    "",
    approved
      ? "Your walk is confirmed for the time above. Our team will contact you if any additional arrangements are needed."
      : "You are welcome to request another available walking time on our website.",
    "",
    "Thank you,",
    "Paws Next Door",
  ].join("\n");
  return {
    to: [appointment.email],
    subject: approved ? "Paws Next Door — your walk is approved" : "Paws Next Door — update on your walk request",
    text: content,
    html: '<div style="font:16px/1.5 Arial,sans-serif;white-space:pre-line">' + emailSafe(content) + "</div>",
  };
}

export async function sendReviewEmail({ env, fetchImpl = fetch, appointment, status, startsAt, timezone }) {
  const key = env.get("RESEND_API_KEY");
  const from = env.get("BOOKING_EMAIL_FROM");
  const adminEmail = env.get("BOOKING_ADMIN_EMAIL");
  if (!key || !from || !adminEmail) return "failed";
  // Do not send real customer mail from Resend's testing address.
  if (/(?:^|<)onboarding@resend\.dev>?$/i.test(from.trim())
    && appointment.email.toLowerCase() !== adminEmail.toLowerCase()) return "test_mode";
  const email = reviewEmail({ appointment, status, startsAt, timezone });
  try {
    const result = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, ...email }),
      signal: AbortSignal.timeout(8000),
    });
    return result.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
