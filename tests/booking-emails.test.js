import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingEmails,
  reviewEmail,
  deliverAppointmentEmails,
} from "../supabase/functions/_shared/booking-emails.js";
import { createBookingHandler } from "../supabase/functions/_shared/booking-handler.js";
const id = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const jobId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const payload = {
  customer_name: "<Mia & Max>",
  email: "neighbor@example.test",
  phone: "5550100",
  dog_name: "Noodle",
  neighborhood: "Northside",
  starts_at: "2026-11-23T16:00:00Z",
  timezone: "America/Chicago",
};
const fields = {
  p_slot_id: jobId,
  p_customer_name: payload.customer_name,
  p_email: payload.email,
  p_phone: payload.phone,
  p_dog_name: payload.dog_name,
  p_neighborhood: payload.neighborhood,
  p_notes: "Private note",
};
const config = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
  RESEND_API_KEY: "fake-resend-key",
  BOOKING_EMAIL_FROM: "Paws Next Door <walks@pawsnextdoor.org>",
  BOOKING_ADMIN_EMAIL: "team@example.test",
  BOOKING_EMAIL_MODE: "production",
};
const env = (values) => ({ get: (key) => values[key] });
const job = (event) => ({ id: jobId, event, payload, lease_token: id });
test("all four email types use human details, root-domain links, escaped HTML and no generated IDs", () => {
  const messages = [
    ...bookingEmails({
      id,
      fields,
      startsAt: payload.starts_at,
      timezone: payload.timezone,
      adminEmail: config.BOOKING_ADMIN_EMAIL,
    }),
    ...["approved", "declined"].map((status) =>
      reviewEmail({
        appointment: { ...payload, id },
        status,
        startsAt: payload.starts_at,
        timezone: payload.timezone,
      }),
    ),
  ];
  assert.match(messages[0].text, /NOT a confirmed walk yet/);
  assert.match(messages[2].text, /confirmed/);
  assert.match(messages[3].text, /can’t accommodate/);
  for (const email of messages) {
    assert.match(email.html, /&lt;Mia &amp; Max&gt;/);
    assert.match(email.text, /Monday, November 23/);
    assert.doesNotMatch(
      JSON.stringify(email),
      /bbbbbbbb-bbbb|aaaaaaaa-aaaa|Private note|Reference:|ba-57\.github/,
    );
    assert.match(email.text, /https:\/\/pawsnextdoor\.org\//);
  }
  assert.match(messages[1].text, /https:\/\/pawsnextdoor\.org\/#admin/);
});
test("all queued notification types send server-side with stable idempotency and monitored Reply-To", async () => {
  for (const event of ["receipt", "admin_request", "approved", "declined"]) {
    const sent = [],
      finished = [];
    const fetchImpl = async (url, init) => {
      if (url.endsWith("/claim_booking_emails"))
        return Response.json([job(event)]);
      if (url === "https://api.resend.com/emails") {
        sent.push({ headers: init.headers, body: JSON.parse(init.body) });
        return Response.json({ id: "provider-message" });
      }
      if (url.endsWith("/finish_booking_email")) {
        finished.push(JSON.parse(init.body));
        return Response.json(true);
      }
      throw Error("Unexpected network call");
    };
    assert.deepEqual(
      await deliverAppointmentEmails({ env: env(config), fetchImpl, id }),
      { notification: "accepted" },
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].headers["Idempotency-Key"], "paws-booking/" + jobId);
    assert.equal(sent[0].body.reply_to, "team@example.test");
    assert.deepEqual(sent[0].body.to, [
      event === "admin_request" ? "team@example.test" : "neighbor@example.test",
    ]);
    assert.equal(finished[0].p_status, "accepted");
    assert.equal(finished[0].p_lease_token, id);
    assert.doesNotMatch(
      JSON.stringify(sent[0].body),
      /bbbbbbbb-bbbb|aaaaaaaa-aaaa/,
    );
  }
});
test("missing configuration, implicit test mode and sandbox sender never enable general customer delivery", async () => {
  let calls = 0;
  for (const values of [
    {},
    { ...config, BOOKING_EMAIL_MODE: undefined },
    { ...config, BOOKING_EMAIL_FROM: "onboarding@resend.dev" },
    {
      ...config,
      BOOKING_EMAIL_FROM: "walks@pawsnextdoor.org\r\nBcc: bad@example.test",
    },
  ]) {
    assert.deepEqual(
      await deliverAppointmentEmails({
        env: env(values),
        id,
        fetchImpl: async () => {
          calls++;
          throw Error("No call expected");
        },
      }),
      { notification: "unconfigured" },
    );
  }
  assert.equal(calls, 0);
});
test("test mode passes its single permitted recipient and blocks even a wrongly returned queue recipient", async () => {
  const calls = [];
  const result = await deliverAppointmentEmails({
    env: env({
      ...config,
      BOOKING_EMAIL_MODE: "test",
      BOOKING_TEST_RECIPIENT: "owner@example.test",
      BOOKING_EMAIL_FROM: "onboarding@resend.dev",
    }),
    id,
    fetchImpl: async (url, init) => {
      calls.push(url);
      if (url.endsWith("/claim_booking_emails")) {
        assert.equal(
          JSON.parse(init.body).p_allowed_recipient,
          "owner@example.test",
        );
        return Response.json([job("receipt")]);
      }
      if (url.endsWith("/finish_booking_email")) {
        assert.equal(JSON.parse(init.body).p_status, "failed");
        return Response.json(true);
      }
      throw Error("Sending forbidden");
    },
  });
  assert.deepEqual(result, { notification: "attention" });
  assert.ok(!calls.includes("https://api.resend.com/emails"));
});
test("provider failures and ambiguous acknowledgements are recorded safely, not reported as delivered", async () => {
  for (const provider of [
    async () =>
      Response.json({ message: "private upstream error" }, { status: 429 }),
    async () => {
      throw Error("private network details");
    },
    async () => Response.json({}),
  ]) {
    let completion;
    const result = await deliverAppointmentEmails({
      env: env(config),
      id,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/claim_booking_emails"))
          return Response.json([job("approved")]);
        if (url.includes("api.resend.com")) return provider();
        if (url.endsWith("/finish_booking_email")) {
          completion = JSON.parse(init.body);
          return Response.json(true);
        }
        throw Error("Unexpected call");
      },
    });
    assert.equal(result.notification, "attention");
    assert.equal(completion.p_status, "failed");
    assert.ok(
      ["provider_rejected", "provider_unavailable"].includes(
        completion.p_error,
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /neighbor|private|fake-service|fake-resend/,
    );
  }
});
test("successful booking remains successful when the email queue/provider is unavailable", async () => {
  const events = [];
  const handler = createBookingHandler({
    env: env({
      ...config,
      BOOKING_ALLOWED_ORIGINS: "https://pawsnextdoor.org",
      TURNSTILE_SECRET_KEY: "fake-captcha-secret",
    }),
    fetchImpl: async (url) => {
      events.push(url);
      if (url.includes("siteverify"))
        return Response.json({
          success: true,
          action: "walk_request",
          hostname: "pawsnextdoor.org",
        });
      if (url.endsWith("/request_walk_with_email")) return Response.json(id);
      if (url.endsWith("/claim_booking_emails"))
        return Response.json({ error: "no queue" }, { status: 503 });
      throw Error("Unexpected call");
    },
  });
  const res = await handler(
    new Request("https://example.supabase.co/functions/v1/request-walk", {
      method: "POST",
      headers: { Origin: "https://pawsnextdoor.org" },
      body: JSON.stringify({ fields, token: "fake-token" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id });
  assert.ok(
    events.findIndex((url) => url.endsWith("/claim_booking_emails")) >
      events.findIndex((url) => url.endsWith("/request_walk_with_email")),
  );
});
