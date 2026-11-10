import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, loadEnv } from "vite";
import { validateProductionConfig } from "./release-config.mjs";
import { verifyPagesBuild } from "./check-pages-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = validateProductionConfig({
  ...loadEnv("production", root, "VITE_"),
  ...process.env,
});
// Override only public build configuration, without editing any local environment file.
for (const [name, value] of Object.entries(config)) process.env[name] = value;
await build({ root, mode: "production", base: config.VITE_BASE_PATH });
verifyPagesBuild(root, config);
