import test from "node:test";
import assert from "node:assert/strict";
import { credentialFindings } from "../scripts/check-pages-build.mjs";
import {
  PAGES_BASE_PATH,
  validateProductionConfig,
} from "../scripts/release-config.mjs";

const valid = () => ({
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "a".repeat(30),
  VITE_TURNSTILE_SITE_KEY: "0x" + "a".repeat(20),
  VITE_BASE_PATH: "/",
});
test("Pages production configuration requires all public values and fixes the project path", () => {
  assert.equal(
    validateProductionConfig(valid()).VITE_BASE_PATH,
    PAGES_BASE_PATH,
  );
  assert.doesNotThrow(() =>
    validateProductionConfig({
      ...valid(),
      VITE_TURNSTILE_SITE_KEY: "0x" + "a".repeat(22),
    }),
  );
  assert.throws(
    () =>
      validateProductionConfig({
        ...valid(),
        VITE_TURNSTILE_SITE_KEY: "0x" + "a".repeat(33),
      }),
    /real public Turnstile/,
  );
  for (const name of [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_TURNSTILE_SITE_KEY",
  ]) {
    assert.throws(
      () => validateProductionConfig({ ...valid(), [name]: "" }),
      new RegExp(name),
    );
  }
  for (const key of [
    "sb_publishable_compile_check_only",
    "sb_secret_" + "x".repeat(30),
  ]) {
    assert.throws(() =>
      validateProductionConfig({
        ...valid(),
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    );
  }
  assert.throws(
    () =>
      validateProductionConfig({
        ...valid(),
        VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      }),
    /real public Turnstile/,
  );
});
test("release scanning distinguishes public keys from private credentials", () => {
  assert.deepEqual(credentialFindings(JSON.stringify(valid())), []);
  assert.deepEqual(credentialFindings("sb_secret_" + "x".repeat(30)), [
    "Supabase secret key",
  ]);
  assert.deepEqual(credentialFindings("0x" + "A".repeat(33)), [
    "possible Turnstile Secret Key",
  ]);
  assert.deepEqual(credentialFindings("github_pat_" + "x".repeat(40)), [
    "GitHub credential",
  ]);
  const jwt = (role) =>
    `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  assert.deepEqual(credentialFindings(jwt("anon")), []);
  assert.deepEqual(credentialFindings(jwt("service_role")), [
    "privileged or user JWT",
  ]);
  assert.deepEqual(credentialFindings(jwt("authenticated")), [
    "privileged or user JWT",
  ]);
});
