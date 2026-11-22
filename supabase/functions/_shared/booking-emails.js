// Server-only templates and delivery. Never import this module into frontend code.
const WEBSITE = "https://pawsnextdoor.org/";
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const html = (text) =>
  '<div style="font:16px/1.6 Arial,sans-serif;white-space:pre-line">' +
  escapeHtml(text) +
  "</div>";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function formattedWalk(startsAt, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(startsAt));
}
export function bookingEmails({ fields, startsAt, timezone, adminEmail }) {
  const date = formattedWalk(startsAt, timezone);
  const customer = [
    `Hi ${fields.p_customer_name},`,
    "",
    "We received your Paws Next Door dog-walking request.",
    `Dog: ${fields.p_dog_name}`,
    `Requested walk: ${date}`,
    "",
    "Your time is held while our team reviews it. This is NOT a confirmed walk yet.",
    "We’ll email you after reviewing your request. Please wait for approval before making arrangements.",
    "",
    WEBSITE,
    "",
    "Thank you,",
    "Paws Next Door",
  ].join("\n");
  const admin = [
    "A new Paws Next Door walk request needs review.",
    "",
    `Name: ${fields.p_customer_name}`,
    `Email: ${fields.p_email}`,
    `Phone: ${fields.p_phone}`,
    `Dog: ${fields.p_dog_name}`,
    `Neighborhood: ${fields.p_neighborhood}`,
    `Requested walk: ${date}`,
    "",
    "Review the request in the private dashboard:",
    WEBSITE + "#admin",
    "",
    "The customer receives a request receipt, not approval.",
  ].join("\n");
  return [
    {
      to: [fields.p_email],
      subject: "Paws Next Door — we received your walk request",
      text: customer,
      html: html(customer),
    },
    {
      to: [adminEmail],
      subject: "Paws Next Door — new walk request to review",
      text: admin,
      html: html(admin),
    },
  ];
}
export function reviewEmail({ appointment, status, startsAt, timezone }) {
  if (!["approved", "declined"].includes(status))
    throw new Error("Unsupported email event");
  const approved = status === "approved";
  const text = [
    `Hi ${appointment.customer_name},`,
    "",
    approved
      ? "Good news! Your Paws Next Door walk request has been approved."
      : "We’re sorry, but we can’t accommodate your walk request this time.",
    "",
    `Dog: ${appointment.dog_name}`,
    `Requested time: ${formattedWalk(startsAt, timezone)}`,
    "",
    approved
      ? "Your walk is confirmed for the time above. Our team will contact you if any additional arrangements are needed."
      : "You’re welcome to request another available time on our website.",
    "",
    WEBSITE,
    "",
    "To ask about this walk, reply to this email.",
    "Thank you,",
    "Paws Next Door",
  ].join("\n");
  return {
    to: [appointment.email],
    subject: approved
      ? "Paws Next Door — your walk is approved"
      : "Paws Next Door — update on your walk request",
    text,
    html: html(text),
  };
}
function mailbox(value, display = false) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return null;
  const text = value.trim();
  const address =
    display && text.includes("<")
      ? text.match(/^[^<>]*<([^<>]+)>$/)?.[1]
      : text;
  return address && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)
    ? { text, address }
    : null;
}
function mailConfig(env) {
  const key = env.get("RESEND_API_KEY");
  const from = mailbox(env.get("BOOKING_EMAIL_FROM"), true);
  const admin = mailbox(env.get("BOOKING_ADMIN_EMAIL"));
  const reply = mailbox(
    env.get("BOOKING_EMAIL_REPLY_TO") || env.get("BOOKING_ADMIN_EMAIL"),
  );
  const mode = env.get("BOOKING_EMAIL_MODE") || "test";
  const test = mailbox(env.get("BOOKING_TEST_RECIPIENT"));
  if (
    !key ||
    !from ||
    !admin ||
    !reply ||
    !["test", "production"].includes(mode) ||
    (mode === "test" && !test)
  )
    return null;
  if (
    mode === "production" &&
    from.address.toLowerCase().endsWith("@resend.dev")
  )
    return null;
  return {
    key,
    from: from.text,
    admin: admin.address,
    reply: reply.address,
    allowed: mode === "test" ? test.address : null,
    mode,
  };
}
export async function deliverAppointmentEmails({ env, fetchImpl = fetch, id }) {
  const config = mailConfig(env);
  const url = env.get("SUPABASE_URL"),
    serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!config || !url || !serviceKey || !uuid.test(id))
    return { notification: "unconfigured" };
  const rpc = async (name, body) => {
    const res = await fetchImpl(url + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("Email queue unavailable");
    return res.json();
  };
  try {
    const jobs = await rpc("claim_booking_emails", {
      p_appointment_id: id,
      p_admin_email: config.admin,
      p_allowed_recipient: config.allowed,
    });
    if (!Array.isArray(jobs)) throw new Error("Invalid queue response");
    const results = await Promise.all(
      jobs.map(async (job) => {
        let accepted = false,
          error = "provider_unavailable";
        try {
          const p = job.payload;
          const message = ["receipt", "admin_request"].includes(job.event)
            ? bookingEmails({
                fields: {
                  p_customer_name: p.customer_name,
                  p_email: p.email,
                  p_phone: p.phone,
                  p_dog_name: p.dog_name,
                  p_neighborhood: p.neighborhood,
                },
                startsAt: p.starts_at,
                timezone: p.timezone,
                adminEmail: config.admin,
              })[job.event === "receipt" ? 0 : 1]
            : reviewEmail({
                appointment: p,
                status: job.event,
                startsAt: p.starts_at,
                timezone: p.timezone,
              });
          // Defense in depth: never rely only on a queue filter for test recipients.
          if (
            config.allowed &&
            message.to.some(
              (to) => to.toLowerCase() !== config.allowed.toLowerCase(),
            )
          )
            throw new Error("Recipient restricted");
          const response = await fetchImpl("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + config.key,
              "Content-Type": "application/json",
              "Idempotency-Key": "paws-booking/" + job.id,
            },
            body: JSON.stringify({
              from: config.from,
              reply_to: config.reply,
              ...message,
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (response.ok) {
            const result = await response.json();
            accepted = typeof result.id === "string" && !!result.id;
          } else error = "provider_rejected";
        } catch {
          /* Store a fixed code only, never recipients, payloads, keys or provider bodies. */
        }
        const recorded = await rpc("finish_booking_email", {
          p_id: job.id,
          p_lease_token: job.lease_token,
          p_status: accepted ? "accepted" : "failed",
          p_error: accepted ? null : error,
        });
        return accepted && recorded === true;
      }),
    );
    return {
      notification: results.some((ok) => !ok)
        ? "attention"
        : jobs.length
          ? "accepted"
          : config.mode === "test"
            ? "test_mode"
            : "pending",
    };
  } catch {
    return { notification: "attention" };
  }
}
export async function notifyBooking(options) {
  return deliverAppointmentEmails(options);
}
