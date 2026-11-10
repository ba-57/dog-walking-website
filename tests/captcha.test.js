import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCaptcha } from "../src/captcha.js";

test("CAPTCHA tokens expire and reset; the widget renders once with form-specific action", async () => {
  const dom = new JSDOM('<div id="captcha"></div>');
  let options,
    renders = 0,
    changes = 0;
  const win = {
    turnstile: {
      render(container, config) {
        renders++;
        options = config;
        return "widget-1";
      },
      reset(id) {
        assert.equal(id, "widget-1");
      },
    },
  };
  const captcha = createCaptcha("public-site-key", dom.window.document, win);
  captcha.onChange(() => changes++);
  await captcha.mount(dom.window.document.getElementById("captcha"));
  await captcha.mount(dom.window.document.getElementById("captcha"));
  assert.equal(renders, 1);
  assert.equal(options.action, "walk_request");
  options.callback("verified-token");
  assert.equal(captcha.getToken(), "verified-token");
  options["expired-callback"]();
  assert.equal(captcha.getToken(), "");
  options.callback("another-token");
  captcha.reset();
  assert.equal(captcha.getToken(), "");
  assert.equal(changes, 4);
  dom.window.close();
});
