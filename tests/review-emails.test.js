import test from "node:test";
import assert from "node:assert/strict";
import { createReviewHandler } from "../supabase/functions/_shared/review-handler.js";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const values = {
  BOOKING_ALLOWED_ORIGINS: "https://pawsnextdoor.org",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service",
  RESEND_API_KEY: "fake-resend",
  BOOKING_EMAIL_FROM: "walks@pawsnextdoor.org",
  BOOKING_ADMIN_EMAIL: "team@example.test",
  BOOKING_EMAIL_MODE: "production",
};
const env = { get: (key) => values[key] };
const req = (
  body = { id, status: "approved" },
  authorization = "Bearer user-token",
  origin = "https://pawsnextdoor.org",
) =>
  new Request("https://example.supabase.co/functions/v1/review-walk", {
    method: "POST",
    headers: { Origin: origin, Authorization: authorization },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
test("review rejects origins, malformed bodies, missing authorization and invalid statuses before any private operation", async () => {
  let calls = 0;
  const handler = createReviewHandler({
    env,
    fetchImpl: async () => {
      calls++;
      throw Error("Unexpected call");
    },
  });
  assert.equal((await handler(req({}, "", undefined))).status, 401);
  assert.equal(
    (await handler(req({}, "Bearer x", "https://unapproved.example"))).status,
    403,
  );
  for (const body of [
    "bad-json",
    null,
    { id, status: "cancelled" },
    { id: "bad", status: "approved" },
  ])
    assert.equal((await handler(req(body))).status, 400);
  assert.equal(calls, 0);
});
test("invalid sessions and authenticated non-admins cannot mutate, read the queue, retry or send", async () => {
  for (const retry of [false, true])
    for (const validSession of [false, true]) {
      const calls = [];
      const handler = createReviewHandler({
        env,
        fetchImpl: async (url) => {
          calls.push(url);
          if (url.endsWith("/auth/v1/user"))
            return Response.json(validSession ? { id: "signed-in-user" } : {}, {
              status: validSession ? 200 : 401,
            });
          if (url.endsWith("/is_admin")) return Response.json(false);
          throw Error("Private operation forbidden");
        },
      });
      assert.equal(
        (
          await handler(
            req(
              retry
                ? { id, action: "retry_notifications" }
                : { id, status: "approved" },
            ),
          )
        ).status,
        validSession ? 403 : 401,
      );
      assert.ok(
        !calls.some((url) => /claim_booking|admin_review|api.resend/.test(url)),
      );
    }
});
test("approval and decline commit through the user-authorized wrapper before delivery; rejected transitions do not send", async () => {
  for (const status of ["approved", "declined"])
    for (const success of [false, true]) {
      const calls = [];
      const handler = createReviewHandler({
        env,
        fetchImpl: async (url, init) => {
          calls.push(url);
          if (url.endsWith("/auth/v1/user"))
            return Response.json({ id: "admin" });
          if (url.endsWith("/is_admin")) return Response.json(true);
          if (url.endsWith("/admin_review_with_email")) {
            assert.equal(init.headers.Authorization, "Bearer user-token");
            assert.equal(JSON.parse(init.body).p_status, status);
            return success
              ? new Response(null, { status: 204 })
              : Response.json({}, { status: 409 });
          }
          if (url.endsWith("/claim_booking_emails")) return Response.json([]);
          throw Error("Unexpected call");
        },
      });
      const res = await handler(req({ id, status }));
      assert.equal(res.status, success ? 200 : 409);
      assert.equal(
        calls.some((url) => url.endsWith("/claim_booking_emails")),
        success,
      );
      if (success)
        assert.deepEqual(await res.json(), {
          updated: true,
          notification: "pending",
        });
    }
});
test("mail errors after an authorized status change return success plus attention, so an admin does not repeat the transition", async () => {
  const handler = createReviewHandler({
    env,
    fetchImpl: async (url) => {
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "admin" });
      if (url.endsWith("/is_admin")) return Response.json(true);
      if (url.endsWith("/admin_review_with_email"))
        return new Response(null, { status: 204 });
      if (url.endsWith("/claim_booking_emails"))
        throw Error("Private failure details");
      throw Error("Unexpected call");
    },
  });
  const res = await handler(req());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    updated: true,
    notification: "attention",
  });
});
test("authorized email retry does not repeat a database status change", async () => {
  const calls = [];
  const handler = createReviewHandler({
    env,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "admin" });
      if (url.endsWith("/is_admin")) return Response.json(true);
      if (url.endsWith("/claim_booking_emails")) return Response.json([]);
      throw Error("No status transition expected");
    },
  });
  const res = await handler(req({ id, action: "retry_notifications" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    updated: false,
    notification: "pending",
  });
  assert.ok(!calls.some((url) => url.includes("admin_review")));
});
