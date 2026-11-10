// Dependency-free handler shared by the deployed Edge Function and local tests.
export function createBookingHandler({ env, fetchImpl = fetch }) {
  return async function handle(request) {
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
    const response = (status, body) =>
      new Response(JSON.stringify(body), { status, headers });
    if (!allowed.includes(origin))
      return response(403, {
        error: "This website is not enabled for booking.",
      });
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return response(405, { error: "Use POST to request a walk." });
    const secret = env.get("TURNSTILE_SECRET_KEY");
    const url = env.get("SUPABASE_URL");
    const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !url || !key)
      return response(503, {
        error: "Online requests are not open yet. Please try again later.",
      });
    try {
      if (Number(request.headers.get("Content-Length")) > 8192)
        return response(413, { error: "Request is too large." });
      const raw = await request.text();
      if (raw.length > 8192)
        return response(413, { error: "Request is too large." });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return response(400, { error: "Please check the request details." });
      }
      if (
        !body ||
        typeof body.token !== "string" ||
        body.token.length < 1 ||
        body.token.length > 2048 ||
        !body.fields ||
        typeof body.fields !== "object"
      )
        return response(400, {
          error: "Please complete the security check and try again.",
        });
      const fields = {};
      const limits = {
        p_slot_id: 36,
        p_customer_name: 100,
        p_email: 254,
        p_phone: 30,
        p_dog_name: 80,
        p_neighborhood: 200,
        p_notes: 1000,
      };
      for (const [name, max] of Object.entries(limits)) {
        const value = body.fields[name];
        if (
          typeof value !== "string" ||
          value.length > max ||
          (name !== "p_notes" && !value.trim())
        )
          return response(400, { error: "Please check the request details." });
        fields[name] = value.trim();
      }
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          fields.p_slot_id,
        )
      )
        return response(400, {
          error: "Please choose an available walking time.",
        });
      const verification = await fetchImpl(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret, response: body.token }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!verification.ok)
        return response(503, {
          error: "The security check is unavailable. Please try again.",
        });
      const verified = await verification.json();
      // Bind tokens to this specific form and an explicitly allowed hostname.
      const host = new URL(origin).hostname;
      if (
        !verified.success ||
        verified.action !== "walk_request" ||
        verified.hostname !== host
      )
        return response(400, {
          error:
            "The security check expired or failed. Please complete it again.",
        });
      const saved = await fetchImpl(`${url}/rest/v1/rpc/request_walk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(fields),
        signal: AbortSignal.timeout(10000),
      });
      const result = await saved.json();
      if (!saved.ok) {
        if (result.code === "P0001")
          return response(409, { error: result.message });
        return response(400, {
          error:
            "We couldn’t submit this request. Please check your details and refresh the available times.",
        });
      }
      return response(200, { id: result });
    } catch {
      // Never log contact information, tokens, keys, or upstream response bodies.
      return response(503, {
        error:
          "We couldn’t connect. Your request may have arrived; please wait for the team to contact you before resubmitting.",
      });
    }
  };
}
