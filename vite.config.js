import { defineConfig, loadEnv } from "vite";
import { validatePublicConfig } from "./src/config.js";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  validatePublicConfig(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  return { base: env.VITE_BASE_PATH || "/", build: { sourcemap: false } };
});
