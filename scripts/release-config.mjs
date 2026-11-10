import { validatePublicConfig } from "../src/config.js";

export const PAGES_BASE_PATH = "/dog-walking-website/";
export const PUBLIC_BUILD_VARIABLES = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_TURNSTILE_SITE_KEY",
];

export function validateProductionConfig(env) {
  const config = {};
  for (const name of PUBLIC_BUILD_VARIABLES) {
    const value = env[name]?.trim();
    if (!value)
      throw new Error(
        `Missing ${name}. Set it in GitHub Settings > Secrets and variables > Actions > Variables.`,
      );
    config[name] = value;
  }
  validatePublicConfig(
    config.VITE_SUPABASE_URL,
    config.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  if (
    !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(
      config.VITE_SUPABASE_PUBLISHABLE_KEY,
    )
  ) {
    throw new Error(
      "Production requires a real Supabase publishable key. Never use a secret or service-role key.",
    );
  }
  if (!/^0x[A-Za-z0-9_-]{20,30}$/.test(config.VITE_TURNSTILE_SITE_KEY)) {
    throw new Error(
      "Production requires the real public Turnstile Site Key, not a test key or Secret Key.",
    );
  }
  if (
    Object.values(config).some((value) =>
      /YOUR_|PASTE_|compile_check/i.test(value),
    )
  ) {
    throw new Error("Replace example build values before deploying.");
  }
  return { ...config, VITE_BASE_PATH: PAGES_BASE_PATH };
}
