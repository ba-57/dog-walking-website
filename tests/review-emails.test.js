import test from "node:test";
import assert from "node:assert/strict";
import { createReviewHandler } from "../supabase/functions/_shared/review-handler.js";
import { reviewEmail } from "../supabase/functions/_shared/booking-emails.js";

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const values = {
  BOOKING_ALLOWED_ORIGINS: "https://ba-57.github.io",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
  RESEND_API_KEY: "fake-resend-key",
  BOOKING_EMAIL_FROM: "onboarding@resend.dev",
  BOOKING_ADMIN_EMAIL: "owner@example.com",
};
const env = { get: (key) => values[key] };
function request(status = "approved", token = "valid-user-token") {
  return new Request("https://example.supabase.co/functions/v1/review-walk", {
    method: "POST",
    headers: {
      Origin: "https://ba-57.github.io",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, status }),
  });
}
test("approve and decline email templates omit internal IDs and escape untrusted customer text", () => {
  for (const status of ["approved", "declined"]) {
    const email = reviewEmail({
      appointment: { customer_name: "<Alex>", dog_name: "Buddy", email: "customer@example.com" },
      status, startsAt: "2026-11-18T16:00:00Z", timezone: "America/Chicago",
    });
    assert.deepEqual(email.to, ["customer@example.com"]);
    assert.match(email.html, /&lt;Alex&gt;/);
    assert.doesNotMatch(JSON.stringify(email), /aaaaaaaa-aaaa/);
    assert.match(email.text, /Wednesday, November 18/);
    assert.match(email.text, status === "approved" ? /approved/ : /can't accommodate/);
  }
});
test("admin route requires valid authorization before mutating", async () => {
  let mutations = 0;
  const handler = createReviewHandler({
    env,
    fetchImpl: async (url) => {
      if (url.endsWith("/auth/v1/user")) return Response.json({ message: "unauthorized" }, { status: 401 });
      if (url.includes("/rpc/")) mutations++;
      return Response.json({});
    },
  });
  const response = await handler(request());
  assert.equal(response.status, 401);
  assert.equal(mutations, 0);
});
test("unauthorized database membership cannot update or notify", async () => {
  let emailCalls = 0;
  const handler = createReviewHandler({
    env,
    fetchImpl: async (url) => {
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "signed-in-user" });
      if (url.includes("/rpc/admin_review_request"))
        return Response.json({ code: "42501", message: "Administrator access required." }, { status: 403 });
      if (url.includes("api.resend.com")) emailCalls++;
      return Response.json({});
    },
  });
  const response = await handler(request());
  assert.equal(response.status, 403);
  assert.equal(emailCalls, 0);
});
test("successful admin review in sandbox does not email unrelated customers", async () => {
  let rpcCalls = 0;
  let emailCalls = 0;
  const handler = createReviewHandler({
    env,
    fetchImpl: async (url) => {
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "signed-in-admin" });
      if (url.includes("/rpc/admin_review_request")) { rpcCalls++; return new Response(null, { status: 204 }); }
      if (url.includes("/rest/v1/appointments"))
        return Response.json([{ email: "neighbor@example.com", customer_name: "Neighbor", dog_name: "Buddy", slot_id: id }]);
      if (url.includes("/rest/v1/walk_slots")) return Response.json([{ starts_at: "2026-11-18T16:00:00Z" }]);
      if (url.includes("/rest/v1/service_settings")) return Response.json([{ timezone: "America/Chicago" }]);
      if (url.includes("api.resend.com")) emailCalls++;
      throw Error("Unexpected call: " + url);
    },
  });
  const response = await handler(request("declined"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { updated: true, notification: "test_mode" });
  assert.equal(rpcCalls, 1);
  assert.equal(emailCalls, 0);
});
test("a rejected state transition does not send an email", async () => {
  let emailCalls = 0;
  const handler = createReviewHandler({
    env,
    fetchImpl: async (url) => {
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "signed-in-admin" });
      if (url.includes("/rpc/admin_review_request"))
        return Response.json({ code: "P0001", message: "Conflict" }, { status: 409 });
      if (url.includes("api.resend.com")) emailCalls++;
      throw Error("Unexpected call: " + url);
    },
  });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal(emailCalls, 0);
});
