import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { initApp } from "../src/app.js";
import { createPreviewApi } from "../src/preview.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const slot = {
  id: "slot-1",
  day: "2026-11-11",
  starts_at: "2026-11-11T16:00:00Z",
  ends_at: "2026-11-11T16:30:00Z",
  is_open: true,
};
const c = () => ({
  timezone: "America/Chicago",
  today: "2026-11-10",
  last_date: "2026-12-09",
  slots: [{ ...slot }],
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
function setup(overrides = {}, hash = "") {
  const dom = new JSDOM(html, { url: `https://paws.example.test/${hash}` });
  const calls = [];
  let authCallback;
  const api = {
    calendar: async () => c(),
    session: async () => null,
    onAuthChange: (fn) => {
      authCallback = fn;
      return { unsubscribe() {} };
    },
    request: async (fields) => {
      calls.push(fields);
      return "request-reference";
    },
    signIn: async () => {},
    signOut: async () => {},
    isAdmin: async () => true,
    adminData: async () => ({ requests: [], slots: [slot], blocks: [] }),
    addSlot: async (...args) => calls.push(["add", ...args]),
    blockDate: async (...args) => calls.push(["block", ...args]),
    review: async (...args) => calls.push(["review", ...args]),
    setSlot: async (...args) => calls.push(["slot", ...args]),
    ...overrides,
  };
  const app = initApp({
    api,
    captcha: {
      configured: true,
      getToken: () => "test-token",
      mount() {},
      onChange() {},
      reset() {},
    },
    document: dom.window.document,
    window: dom.window,
  });
  return {
    dom,
    app,
    api,
    calls,
    $: (id) => dom.window.document.getElementById(id),
    expire: () => authCallback(null),
    close() {
      app.destroy();
      dom.window.close();
    },
  };
}
async function selectSlot(s) {
  await s.app.ready;
  s.$("calendar-grid").querySelector("button:not(:disabled)").click();
  s.$("available-times").querySelector("button").click();
}
function fillForm(s) {
  for (const [name, value] of Object.entries({
    customer_name: "Neighbor",
    email: "neighbor@example.test",
    phone: "5550100100",
    dog_name: "Sunny",
    neighborhood: "Example area",
    notes: "A gentle pace",
  }))
    s.$("request-form").elements[name].value = value;
  s.$("request-form").elements.consent.checked = true;
}
const sampleRequest = {
  id: "request-1",
  slot_id: slot.id,
  dog_name: "Sunny",
  customer_name: "Neighbor",
  email: "neighbor@example.test",
  phone: "5550100100",
  neighborhood: "Example area",
  notes: "<img src=x onerror=alert(1)>",
  status: "pending",
};

test("visitor selects a time, submits once and gets pending confirmation", async () => {
  const s = setup();
  await selectSlot(s);
  assert.equal(s.$("request-form").hidden, false);
  assert.match(s.$("request-summary").textContent, /10:00 AM/);
  fillForm(s);
  s.$("request-form").dispatchEvent(
    new s.dom.window.Event("submit", { cancelable: true }),
  );
  s.$("request-form").dispatchEvent(
    new s.dom.window.Event("submit", { cancelable: true }),
  );
  await tick();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].p_slot_id, slot.id);
  assert.equal(s.calls[0].p_email, "neighbor@example.test");
  assert.equal(s.$("request-form").hidden, true);
  assert.match(
    s.$("request-message").textContent,
    /received.*request-reference.*reviews it/,
  );
  assert.equal(s.$("request-form").elements.customer_name.value, "");
  s.close();
});
test("conflict refreshes available times and retains entered contact details", async () => {
  let booked = false;
  const s = setup({
    calendar: async () => ({ ...c(), slots: booked ? [] : [slot] }),
    request: async () => {
      booked = true;
      throw {
        code: "P0001",
        message: "This time is no longer available. Please choose another.",
      };
    },
  });
  await selectSlot(s);
  fillForm(s);
  s.$("request-form").dispatchEvent(
    new s.dom.window.Event("submit", { cancelable: true }),
  );
  await tick();
  assert.match(s.$("request-message").textContent, /no longer available/);
  assert.equal(
    s.$("request-form").elements.email.value,
    "neighbor@example.test",
  );
  assert.equal(
    s.$("calendar-grid").querySelectorAll("button:not(:disabled)").length,
    0,
  );
  s.close();
});
test("calendar network failure disables stale slots and allows retry", async () => {
  let fail = false;
  const s = setup({
    calendar: async () => {
      if (fail) throw new Error("Connection unavailable");
      return c();
    },
  });
  await selectSlot(s);
  fail = true;
  await s.app.refreshCalendar();
  assert.equal(s.$("request-form").hidden, true);
  assert.match(s.$("calendar-status").textContent, /Connection unavailable/);
  assert.equal(
    s.$("calendar-grid").querySelectorAll("button:not(:disabled)").length,
    0,
  );
  fail = false;
  await s.app.refreshCalendar();
  assert.equal(
    s.$("calendar-grid").querySelectorAll("button:not(:disabled)").length,
    1,
  );
  s.close();
});
test("missing configuration is explicit and never offers simulated bookings", async () => {
  const dom = new JSDOM(html, { url: "https://paws.example.test/" });
  const app = initApp({
    api: null,
    document: dom.window.document,
    window: dom.window,
  });
  await app.ready;
  assert.match(
    dom.window.document.getElementById("calendar-status").textContent,
    /finishing booking setup/,
  );
  assert.equal(
    dom.window.document.querySelectorAll(".calendar-day:not(:disabled)").length,
    0,
  );
  app.destroy();
  dom.window.close();
});
test("signed-out visitors and non-admin accounts never load customer records", async () => {
  let privateReads = 0;
  const s = setup(
    {
      adminData: async () => {
        privateReads++;
        return {};
      },
    },
    "#admin",
  );
  await s.app.ready;
  assert.equal(s.$("admin-dashboard").hidden, true);
  assert.equal(s.$("login-form").hidden, false);
  assert.equal(privateReads, 0);
  s.close();
  const other = setup(
    {
      session: async () => ({ user: {} }),
      isAdmin: async () => false,
      adminData: async () => {
        privateReads++;
      },
    },
    "#admin",
  );
  await other.app.ready;
  assert.equal(other.$("admin-dashboard").hidden, true);
  assert.match(
    other.$("admin-message").textContent,
    /does not have administrator access/,
  );
  assert.equal(privateReads, 0);
  other.close();
});
test("admin review, availability changes, safe text rendering, and session expiry", async () => {
  let data = { requests: [sampleRequest], slots: [slot], blocks: [] };
  const s = setup(
    { session: async () => ({ user: {} }), adminData: async () => data },
    "#admin",
  );
  await s.app.ready;
  assert.equal(s.$("admin-dashboard").hidden, false);
  assert.match(s.$("request-list").textContent, /Sunny/);
  assert.equal(s.$("request-list").querySelector("img"), null);
  assert.match(s.$("request-list").textContent, /<img src=x/);
  s.$("request-list").querySelector("button").click();
  await tick();
  assert.deepEqual(s.calls[0], ["review", "request-1", "approved"]);
  s.$("availability-tab").click();
  assert.equal(s.$("availability-panel").hidden, false);
  const form = s.$("add-slot-form");
  form.elements.day.value = "2026-11-12";
  form.elements.time.value = "15:00";
  form.dispatchEvent(new s.dom.window.Event("submit", { cancelable: true }));
  await tick();
  assert.deepEqual(s.calls[1], ["add", "2026-11-12", "15:00"]);
  const block = s.$("block-date-form");
  block.elements.day.value = "2026-11-13";
  block.dispatchEvent(new s.dom.window.Event("submit", { cancelable: true }));
  await tick();
  assert.deepEqual(s.calls[2], ["block", "2026-11-13", true]);
  s.expire();
  assert.equal(s.$("admin-dashboard").hidden, true);
  assert.equal(s.$("request-list").textContent, "");
  assert.equal(s.$("admin-slots").textContent, "");
  s.close();
});
test("a late private-data response cannot repopulate the dashboard after sign-out", async () => {
  let release;
  const s = setup(
    {
      session: async () => ({ user: {} }),
      adminData: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    "#admin",
  );
  await tick();
  s.expire();
  release({ requests: [sampleRequest], slots: [slot], blocks: [] });
  await s.app.ready;
  assert.equal(s.$("admin-dashboard").hidden, true);
  assert.equal(s.$("request-list").textContent, "");
  s.close();
});
test("explicit design preview has fictional data and rejects all writes", async () => {
  const api = createPreviewApi();
  assert.equal((await api.calendar()).slots.length, 25);
  for (const method of [
    "request",
    "addSlot",
    "setSlot",
    "blockDate",
    "review",
    "signIn",
  ])
    await assert.rejects(api[method](), /read-only design preview/);
  const s = setup(api, "#admin");
  await s.app.ready;
  assert.match(s.$("admin-message").textContent, /fictional/);
  assert.ok(
    [...s.$("request-list").querySelectorAll("button")].every(
      (b) => b.disabled,
    ),
  );
  assert.ok(
    [...s.$("admin-dashboard").querySelectorAll('button[type="submit"]')].every(
      (b) => b.disabled,
    ),
  );
  s.close();
});
