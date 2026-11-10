import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicConfig } from "../src/config.js";
const jwt = (role) => `header.${btoa(JSON.stringify({ role }))}.signature`;
test("only public keys can enter the browser build", () => {
  assert.equal(validatePublicConfig(undefined, undefined), false);
  assert.equal(
    validatePublicConfig(
      "https://example.supabase.co",
      "sb_publishable_example",
    ),
    true,
  );
  assert.equal(
    validatePublicConfig("https://example.supabase.co", jwt("anon")),
    true,
  );
  for (const key of [
    "sb_secret_example",
    jwt("service_role"),
    jwt("authenticated"),
    "unknown",
  ])
    assert.throws(
      () => validatePublicConfig("https://example.supabase.co", key),
      /publishable or legacy anon/,
    );
  assert.throws(
    () =>
      validatePublicConfig(
        "http://example.supabase.co",
        "sb_publishable_example",
      ),
    /HTTPS/,
  );
  assert.throws(
    () => validatePublicConfig("https://example.supabase.co"),
    /both/,
  );
});
