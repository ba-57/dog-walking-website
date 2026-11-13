import test from "node:test";
import assert from "node:assert/strict";
import { bookingEmails, notifyBooking } from "../supabase/functions/_shared/booking-emails.js";
import { createBookingHandler } from "../supabase/functions/_shared/booking-handler.js";

const fields = {
  p_slot_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  p_customer_name: "<Mia & Max>",
  p_email: "mia@example.com",
  p_phone: "555-0100",
  p_dog_name: "Noodle",
  p_neighborhood: "Northside",
  p_notes: "Keep this private",
};
const id = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const env = (values) => ({ get: (key) => values[key] });

test("mail templates escape HTML, omit private notes, and do not imply approval", () => {
  const emails = bookingEmails({
    id, fields, startsAt: "2026-11-18T16:00:00Z",
    timezone: "America/Chicago", adminEmail: "admin@example.com",
  });
  assert.equal(emails.length, 2);
  assert.deepEqual(emails.map((e) => e.to), [["mia@example.com"], ["admin@example.com"]]);
  assert.match(emails[0].text, /NOT a confirmed walk yet/);
  assert.match(emails[0].text, /Wednesday, November 18, 2026/);
  assert.match(emails[0].html, /&lt;Mia &amp; Max&gt;/);
  assert.doesNotMatch(JSON.stringify(emails), /Keep this private/);
});

test("missing email credentials never trigger a send", async () => {
  let called = false;
  const outcome = await notifyBooking({
    env: env({}), id, fields,
    fetchImpl: async () => { called = true; throw Error("unexpected call"); },
  });
  assert.deepEqual(outcome, { configured: false });
  assert.equal(called, false);
});

test("both messages are sent only after saved-booking callback", async () => {
  const sent = [];
  const mockFetch = async (url, init) => {
    if (url.includes("/rest/v1/walk_slots")) {
      return Response.json([{ starts_at: "2026-11-18T16:00:00Z" }]);
    }
    if (url.includes("/rest/v1/service_settings")) {
      return Response.json([{ timezone: "America/Chicago" }]);
    }
    if (url.includes("api.resend.com")) {
      sent.push({ ...JSON.parse(init.body), auth: init.headers.Authorization });
      return Response.json({ id: "mock-email-id" });
    }
    throw Error("unexpected URL " + url);
  };
  const result = await notifyBooking({
    env: env({
      RESEND_API_KEY: "mock-secret", BOOKING_EMAIL_FROM: "Paws Next Door <walks@example.org>",
      BOOKING_ADMIN_EMAIL: "admin@example.com",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "mock-service-key",
    }), fetchImpl: mockFetch, id, fields,
  });
  assert.deepEqual(result, { configured: true, sent: 2 });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].auth, "Bearer mock-secret");
  assert.equal(sent[1].subject, "Paws Next Door — new walk request to review");
});

test("email failure never changes a successful booking response", async () => {
  const calls = [];
  const values = {
    BOOKING_ALLOWED_ORIGINS: "https://ba-57.github.io",
    TURNSTILE_SECRET_KEY: "mock-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "mock-service-key",
    RESEND_API_KEY: "mock-resend",
    BOOKING_EMAIL_FROM: "walks@example.org",
    BOOKING_ADMIN_EMAIL: "admin@example.com",
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("siteverify"))
      return Response.json({ success: true, action: "walk_request", hostname: "ba-57.github.io" });
    if (url.endsWith("/rpc/request_walk")) return Response.json(id);
    if (url.includes("/rest/v1/walk_slots")) return Response.json([]);
    if (url.includes("/rest/v1/service_settings")) return Response.json([]);
    if (url.includes("api.resend.com")) return Response.json({ error: "unavailable" }, { status: 500 });
    throw Error("unexpected URL");
  };
  const handler = createBookingHandler({ env: env(values), fetchImpl });
  const request = new Request("https://example.supabase.co/functions/v1/request-walk", {
    method: "POST", headers: { Origin: "https://ba-57.github.io", "Content-Type": "application/json" },
    body: JSON.stringify({ fields, token: "captcha-token" }),
  });
  const response = await handler(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id });
  assert.equal(calls.filter((url) => url.includes("api.resend.com")).length, 2);
});

test("failed request does not send any email", async () => {
  let mailCount = 0;
  const handler = createBookingHandler({
    env: env({
      BOOKING_ALLOWED_ORIGINS: "https://ba-57.github.io",
      TURNSTILE_SECRET_KEY: "secret", SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service", RESEND_API_KEY: "resend",
      BOOKING_EMAIL_FROM: "walks@example.org", BOOKING_ADMIN_EMAIL: "admin@example.com",
    }),
    fetchImpl: async (url) => {
      if (url.includes("siteverify")) return Response.json({ success: true, action: "walk_request", hostname: "ba-57.github.io" });
      if (url.includes("rpc/request_walk")) return Response.json({ code: "P0001", message: "Slot unavailable" }, { status: 409 });
      if (url.includes("api.resend.com")) mailCount++;
      return Response.json({});
    },
  });
  const response = await handler(new Request("https://example.supabase.co/functions/v1/request-walk", {
    method: "POST", headers: { Origin: "https://ba-57.github.io" },
    body: JSON.stringify({ fields, token: "captcha-token" }),
  }));
  assert.equal(response.status, 409);
  assert.equal(mailCount, 0);
});

test("Resend test sender only delivers to the verified account address", async () => {
  const sent = [];
  const result = await notifyBooking({
    id, fields,
    env: env({
      RESEND_API_KEY: "fake-key",
      BOOKING_EMAIL_FROM: "onboarding@resend.dev",
      BOOKING_ADMIN_EMAIL: "admin@example.com",
    }),
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.resend.com/emails");
      sent.push(JSON.parse(init.body));
      return Response.json({ id: "mock-message" });
    },
  });
  assert.deepEqual(result, { configured: true, sent: 1 });
  assert.deepEqual(sent[0].to, ["admin@example.com"]);
});
