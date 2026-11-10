import test from "node:test";
import assert from "node:assert/strict";
import { createBookingHandler } from "../supabase/functions/_shared/booking-handler.js";
const origin = "https://paws.example.test";
const fields = {
  p_slot_id: "11111111-1111-4111-8111-111111111111",
  p_customer_name: "Neighbor",
  p_email: "neighbor@example.test",
  p_phone: "5550100100",
  p_dog_name: "Sunny",
  p_neighborhood: "Example area",
  p_notes: "",
};
const environment = {
  BOOKING_ALLOWED_ORIGINS: origin,
  TURNSTILE_SECRET_KEY: "test-server-secret",
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-private-key",
};
const env = { get: (name) => environment[name] };
const request = (body = { fields, token: "test-token" }, extra = {}) =>
  new Request("https://edge.example.test/request-walk", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...extra,
  });
const verified = {
  success: true,
  action: "walk_request",
  hostname: "paws.example.test",
};

test("Edge gateway verifies CAPTCHA before forwarding whitelisted fields to PostgreSQL", async () => {
  const calls = [];
  const handle = createBookingHandler({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return Response.json(verified);
      return Response.json("request-id");
    },
  });
  const res = await handle(
    request({ fields: { ...fields, status: "approved" }, token: "test-token" }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: "request-id" });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /siteverify/);
  assert.equal(JSON.parse(calls[1].options.body).status, undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body), fields);
  assert.equal(
    calls[1].options.headers.Authorization,
    "Bearer test-private-key",
  );
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
});
test("failed, replayed, wrong-host and wrong-action tokens never reach the database", async () => {
  for (const result of [
    { success: false },
    { ...verified, hostname: "evil.example.test" },
    { ...verified, action: "another_form" },
  ]) {
    let calls = 0;
    const handle = createBookingHandler({
      env,
      fetchImpl: async () => {
        calls++;
        return Response.json(result);
      },
    });
    const res = await handle(request());
    assert.equal(res.status, 400);
    assert.equal(calls, 1);
  }
});
test("malformed, oversized and missing-token submissions fail before verification", async () => {
  let calls = 0;
  const handle = createBookingHandler({
    env,
    fetchImpl: async () => {
      calls++;
      throw new Error("should not call");
    },
  });
  for (const body of [
    { fields, token: "" },
    null,
    { fields: { ...fields, p_notes: "x".repeat(1001) }, token: "token" },
    { fields: { ...fields, p_slot_id: "wrong" }, token: "token" },
  ])
    assert.equal((await handle(request(body))).status, 400);
  assert.equal((await handle(request({}, { body: "not-json" }))).status, 400);
  assert.equal(
    (await handle(request({}, { body: "x".repeat(8193) }))).status,
    413,
  );
  assert.equal(calls, 0);
});
test("allowed origins, CORS and unconfigured server fail closed", async () => {
  const handle = createBookingHandler({
    env,
    fetchImpl: async () => {
      throw new Error("should not call");
    },
  });
  assert.equal(
    (
      await handle(
        request({}, { headers: { Origin: "https://evil.example.test" } }),
      )
    ).status,
    403,
  );
  const options = await handle(
    new Request("https://edge.example.test/", {
      method: "OPTIONS",
      headers: { Origin: origin },
    }),
  );
  assert.equal(options.status, 204);
  assert.match(options.headers.get("Access-Control-Allow-Headers"), /apikey/);
  const noSecret = createBookingHandler({
    env: {
      get: (name) =>
        name === "TURNSTILE_SECRET_KEY" ? undefined : environment[name],
    },
  });
  assert.equal((await noSecret(request())).status, 503);
});
test("booking conflict is safe to display and internal database errors stay private", async () => {
  for (const [code, message, status, expected] of [
    [
      "P0001",
      "This time is no longer available.",
      409,
      "This time is no longer available.",
    ],
    [
      "23514",
      "private constraint details",
      400,
      "We couldn’t submit this request. Please check your details and refresh the available times.",
    ],
  ]) {
    let count = 0;
    const handle = createBookingHandler({
      env,
      fetchImpl: async () =>
        ++count === 1
          ? Response.json(verified)
          : Response.json({ code, message }, { status: 400 }),
    });
    const res = await handle(request());
    assert.equal(res.status, status);
    assert.equal((await res.json()).error, expected);
  }
});
