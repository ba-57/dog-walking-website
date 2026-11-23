import { deliverAppointmentEmails } from "./booking-emails.js";

export function createReviewHandler({ env, fetchImpl = fetch }) {
  return async (request) => {
    const allowed = (env.get("BOOKING_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    const respond = (status, body) =>
      new Response(JSON.stringify(body), { status, headers });
    if (!allowed.includes(origin))
      return respond(403, { error: "Origin not allowed." });
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return respond(405, { error: "Use POST." });
    const url = env.get("SUPABASE_URL"),
      key = env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization") || "";
    if (!url || !key) return respond(503, { error: "Review is unavailable." });
    if (!/^Bearer \S+$/i.test(authorization))
      return respond(401, { error: "Sign in as an administrator." });
    let body;
    try {
      if (Number(request.headers.get("Content-Length")) > 1024)
        return respond(413, { error: "Request too large." });
      const raw = await request.text();
      if (raw.length > 1024)
        return respond(413, { error: "Request too large." });
      body = JSON.parse(raw);
    } catch {
      return respond(400, { error: "Invalid review request." });
    }
    const { id, status, action } = body || {};
    const retry = action === "retry_notifications";
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      ) ||
      (!retry && !["approved", "declined"].includes(status)) ||
      (action && !retry)
    )
      return respond(400, { error: "Invalid review request." });
    const userHeaders = {
      apikey: key,
      Authorization: authorization,
      "Content-Type": "application/json",
    };
    try {
      const user = await fetchImpl(url + "/auth/v1/user", {
        headers: userHeaders,
        signal: AbortSignal.timeout(8000),
      });
      if (!user.ok || !(await user.json())?.id)
        return respond(401, { error: "Sign in again." });
      const member = await fetchImpl(url + "/rest/v1/rpc/is_admin", {
        method: "POST",
        headers: userHeaders,
        body: "{}",
        signal: AbortSignal.timeout(8000),
      });
      if (!member.ok || (await member.json()) !== true)
        return respond(403, { error: "Administrator access required." });
      if (!retry) {
        const updated = await fetchImpl(
          url + "/rest/v1/rpc/admin_review_with_email",
          {
            method: "POST",
            headers: userHeaders,
            body: JSON.stringify({ p_id: id, p_status: status }),
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!updated.ok)
          return respond(updated.status === 403 ? 403 : 409, {
            error: "This request could not be updated. Refresh the dashboard.",
          });
      }
      // The status and queue entry have committed. An email error must not undo or re-run review.
      let result;
      try {
        result = await deliverAppointmentEmails({ env, fetchImpl, id });
      } catch {
        result = { notification: "attention" };
      }
      return respond(200, { updated: !retry, ...result });
    } catch {
      return respond(503, {
        error:
          "The request may have changed. Refresh before taking another action.",
      });
    }
  };
}
