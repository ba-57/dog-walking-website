export function createCaptcha(siteKey, doc = document, win = window) {
  let token = "",
    widgetId,
    container,
    onChange = () => {},
    loading;
  const update = (value) => {
    token = value;
    onChange();
  };
  const ensureScript = () => {
    if (win.turnstile) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error("Security check unavailable"));
      };
      doc.head.append(script);
    });
    return loading;
  };
  return {
    configured: !!siteKey,
    getToken: () => token,
    onChange: (callback) => {
      onChange = callback;
    },
    async mount(target) {
      if (!siteKey || widgetId !== undefined) return;
      container = target;
      try {
        await ensureScript();
        if (widgetId !== undefined) return;
        container.replaceChildren();
        widgetId = win.turnstile.render(container, {
          sitekey: siteKey,
          action: "walk_request",
          theme: "light",
          size: "flexible",
          callback: (value) => update(value),
          "expired-callback": () => update(""),
          "error-callback": () => {
            update("");
            return true;
          },
        });
      } catch {
        container.textContent =
          "Security check could not load. Check your connection and select your walking time again.";
      }
    },
    reset() {
      update("");
      if (widgetId !== undefined) win.turnstile.reset(widgetId);
    },
  };
}
