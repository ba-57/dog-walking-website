import "./styles.css";
import { createApi } from "./api.js";
import { createPreviewApi } from "./preview.js";
import { createCaptcha } from "./captcha.js";
import { initApp } from "./app.js";
const preview =
  new URLSearchParams(window.location.search).get("preview") === "1";
const api = preview
  ? createPreviewApi()
  : createApi(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    );
const captcha = createCaptcha(import.meta.env.VITE_TURNSTILE_SITE_KEY);
initApp({ api, captcha, document, window });
