import { sendReviewEmail } from "../_shared/booking-emails.js";

// Authenticated admin-only status update; the existing PostgreSQL RPC enforces admin membership.
export function createReviewHandler({ env, fetchImpl = fetch }) {
  return async (request) => {
    const allowed = (env.get("BOOKING_ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    const respond = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (!allowed.includes(origin)) return respond(403, { error: "Origin not allowed." });
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return respond(405, { error: "Use POST." });

    const url = env.get("SUPABASE_URL");
    const serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization") || "";
    if (!url || !serviceKey) return respond(503, { error: "Review is unavailable." });
    if (!/^Bearer \S+$/i.test(authorization)) return respond(401, { error: "Sign in as an administrator." });
    try {
      if (Number(request.headers.get("Content-Length")) > 1024) return respond(413, { error: "Request too large." });
      const raw = await request.text();
      if (raw.length > 1024) return respond(413, { error: "Request too large." });
      const { id, status } = JSON.parse(raw);
      if (typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
        !["approved", "declined"].includes(status)) return respond(400, { error: "Invalid review request." });

      // Verify actual session with Auth service; database RPC independently checks admin_users.
      const user = await fetchImpl(url + "/auth/v1/user", {
        headers: { apikey: serviceKey, Authorization: authorization },
        signal: AbortSignal.timeout(8000),
      });
      if (!user.ok) return respond(401, { error: "Sign in again." });

      const updated = await fetchImpl(url + "/rest/v1/rpc/admin_review_request", {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ p_id: id, p_status: status }),
        signal: AbortSignal.timeout(8000),
      });
      if (!updated.ok) {
        const error = await updated.json().catch(() => ({}));
        if (error.code === "42501") return respond(403, { error: "Administrator access required." });
        return respond(409, { error: "This request could not be updated. Refresh the dashboard." });
      }
      // Only read contact information after an authorized, successful RPC update.
      const headersDb = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
      const saved = await fetchImpl(url + "/rest/v1/appointments?id=eq." + encodeURIComponent(id) +
        "&select=email,customer_name,dog_name,slot_id", {
        headers: headersDb, signal: AbortSignal.timeout(8000),
      });
      let notification = "failed";
      if (saved.ok) {
        const appointment = (await saved.json())[0];
        if (appointment) {
          const [slot, settings] = await Promise.all([
            fetchImpl(url + "/rest/v1/walk_slots?id=eq." + encodeURIComponent(appointment.slot_id) + "&select=starts_at", {
              headers: headersDb, signal: AbortSignal.timeout(8000),
            }),
            fetchImpl(url + "/rest/v1/service_settings?id=eq.true&select=timezone", {
              headers: headersDb, signal: AbortSignal.timeout(8000),
            }),
          ]);
          const startsAt = slot.ok ? (await slot.json())[0]?.starts_at : null;
          const timezone = settings.ok ? (await settings.json())[0]?.timezone : "America/Chicago";
          notification = await sendReviewEmail({
            env, fetchImpl, appointment, status, startsAt, timezone,
          });
        }
      }
      return respond(200, { updated: true, notification });
    } catch {
      // A successful database update may have completed before an upstream failure.
      return respond(503, { error: "The request may have changed. Refresh before taking another action." });
    }
  };
}
