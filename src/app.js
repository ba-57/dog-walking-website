import {
  addDays,
  calendarCells,
  dayLabel,
  monthFromKey,
  moveMonth,
  slotLabel,
  timeLabel,
} from "./calendar.js";

export function initApp({ api, captcha = null, document: doc, window: win }) {
  const $ = (id) => doc.getElementById(id);
  const state = {
    calendar: null,
    month: null,
    day: null,
    slot: null,
    admin: false,
    data: null,
    busy: false,
    calendarBusy: false,
    adminVersion: 0,
  };
  const el = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const message = (id, text, type = "") => {
    const node = $(id);
    node.textContent = text;
    node.className = `notice ${type}`;
    node.hidden = !text;
  };
  const readableError = (error) => {
    // Show known application errors; do not put database constraint internals in the UI.
    if (
      error?.code === "23514" ||
      error?.code === "23502" ||
      error?.code === "22P02"
    )
      return "Please check your contact details and try again.";
    if (error?.code === "42501")
      return "Administrator access is required. Please sign in again.";
    if (
      error?.code &&
      ![
        "P0001",
        "invalid_credentials",
        "email_not_confirmed",
        "over_request_rate_limit",
      ].includes(error.code)
    )
      return "We couldn’t complete that action. Please refresh and try again.";
    return error?.message || "We couldn’t connect. Please try again.";
  };
  function showCalendar() {
    const c = state.calendar;
    if (!c) return;
    $("calendar-title").textContent = dayLabel(state.month, {
      month: "long",
      year: "numeric",
    });
    $("calendar-zone").textContent =
      `All times in ${c.timezone} · ${dayLabel(c.today, { month: "short", day: "numeric" })} – ${dayLabel(c.last_date, { month: "short", day: "numeric" })}`;
    const grid = $("calendar-grid");
    grid.replaceChildren();
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((day) =>
      grid.append(el("div", day, "weekday-label")),
    );
    calendarCells(state.month, c.today, c.last_date, c.slots).forEach(
      (cell) => {
        if (!cell) {
          grid.append(el("span"));
          return;
        }
        const button = el(
          "button",
          String(cell.day),
          `calendar-day${cell.key === state.day ? " selected" : ""}${cell.key === c.today ? " today" : ""}`,
        );
        button.type = "button";
        button.disabled = !cell.available;
        button.setAttribute(
          "aria-label",
          `${dayLabel(cell.key)}${cell.available ? ", available" : ", unavailable"}`,
        );
        button.setAttribute("aria-pressed", String(cell.key === state.day));
        if (cell.key === c.today) button.setAttribute("aria-current", "date");
        button.addEventListener("click", () => {
          state.day = cell.key;
          state.slot = null;
          message("request-message", "");
          showCalendar();
          showTimes();
        });
        grid.append(button);
      },
    );
    $("previous-month").disabled = state.month <= monthFromKey(c.today);
    $("next-month").disabled = state.month >= monthFromKey(c.last_date);
  }
  function showTimes() {
    const c = state.calendar;
    const times = $("available-times");
    times.replaceChildren();
    $("request-form").hidden = !state.slot;
    $("selected-date").textContent = state.day
      ? dayLabel(state.day)
      : "A good day for a walk.";
    const slots = c?.slots.filter((s) => s.day === state.day) || [];
    $("time-help").textContent = state.day
      ? slots.length
        ? `30-minute walks · ${c.timezone}`
        : "No times left on this day. Please choose another."
      : "Select an available date to see walking times.";
    for (const slot of slots) {
      const button = el(
        "button",
        timeLabel(slot.starts_at, c.timezone),
        `time-button${slot.id === state.slot?.id ? " selected" : ""}`,
      );
      button.type = "button";
      button.setAttribute("aria-pressed", String(slot.id === state.slot?.id));
      button.addEventListener("click", () => {
        state.slot = slot;
        showTimes();
      });
      times.append(button);
    }
    $("submit-request").disabled =
      state.busy || !!api?.preview || !captcha?.getToken();
    if (state.slot && !api?.preview) {
      if (captcha?.configured) captcha.mount($("captcha-container"));
      else
        $("captcha-container").textContent =
          "Online requests are not open yet. The security check still needs to be configured.";
    }
    if (state.slot)
      $("request-summary").textContent =
        `${slotLabel(state.slot, c.timezone)} · ${c.timezone} · 30 minutes · Free${api?.preview ? " · Read-only preview; requests are disabled." : ""}`;
  }
  async function refreshCalendar({ quiet = false } = {}) {
    if (state.calendarBusy) return;
    state.calendarBusy = true;
    $("refresh-calendar").disabled = true;
    if (!quiet) message("calendar-status", "Checking available walking times…");
    try {
      if (!api)
        throw new Error(
          "Online requests are not open yet. The team is finishing booking setup. Please check back soon.",
        );
      const c = await api.calendar();
      if (
        !c ||
        !Array.isArray(c.slots) ||
        !c.timezone ||
        !c.today ||
        !c.last_date
      )
        throw new Error(
          "Walking times are temporarily unavailable. Please try again.",
        );
      state.calendar = c;
      if (
        !state.month ||
        state.month < monthFromKey(c.today) ||
        state.month > monthFromKey(c.last_date)
      )
        state.month = monthFromKey(c.today);
      if (state.slot && !c.slots.some((s) => s.id === state.slot.id)) {
        state.slot = null;
        message(
          "request-message",
          "That time is no longer available. Please choose another.",
        );
      }
      if (state.day && !c.slots.some((s) => s.day === state.day))
        state.day = null;
      message(
        "calendar-status",
        api.preview
          ? "Design preview · These are sample times. Requests and dashboard changes are disabled."
          : c.slots.length
            ? ""
            : "There are no available walks in the next 30 days yet. Please check back soon.",
      );
      showCalendar();
      showTimes();
    } catch (error) {
      // Disable stale times after a network failure; the database still checks every request.
      state.slot = null;
      const today = new Date().toISOString().slice(0, 10);
      state.calendar ||= {
        today,
        last_date: addDays(today, 29),
        timezone: "UTC",
        slots: [],
      };
      state.calendar.slots = [];
      state.month ||= monthFromKey(state.calendar.today);
      state.day = null;
      showCalendar();
      showTimes();
      message("calendar-status", readableError(error), api ? "error" : "");
    } finally {
      state.calendarBusy = false;
      $("refresh-calendar").disabled = false;
    }
  }
  captcha?.onChange(() => {
    $("submit-request").disabled =
      state.busy || !state.slot || !!api?.preview || !captcha.getToken();
  });
  $("previous-month").addEventListener("click", () => {
    state.month = moveMonth(state.month, -1);
    showCalendar();
  });
  $("next-month").addEventListener("click", () => {
    state.month = moveMonth(state.month, 1);
    showCalendar();
  });
  $("refresh-calendar").addEventListener("click", () => refreshCalendar());
  $("request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      !state.slot ||
      state.busy ||
      !api ||
      !captcha?.getToken() ||
      api.preview ||
      !$("request-form").reportValidity()
    )
      return;
    state.busy = true;
    $("submit-request").disabled = true;
    $("submit-request").textContent = "Sending your request…";
    const data = new win.FormData(event.currentTarget);
    const fields = { p_slot_id: state.slot.id };
    [
      "customer_name",
      "email",
      "phone",
      "dog_name",
      "neighborhood",
      "notes",
    ].forEach((key) => {
      fields[`p_${key}`] = String(data.get(key) || "").trim();
    });
    try {
      await api.request(fields, captcha.getToken());
      state.slot = null;
      state.day = null;
      $("request-form").reset();
      $("request-form").hidden = true;
      await refreshCalendar({ quiet: true });
      message(
        "request-message",
        "Thank you! Your walk request has been received. We’ll contact you once it’s reviewed. Your walk is not confirmed yet.",
        "success",
      );
      $("request-message").focus();
    } catch (error) {
      message(
        "request-message",
        `${readableError(error)} If your connection was interrupted, your request may already have arrived. Please wait for the team to contact you before resubmitting.`,
        "error",
      );
      // Keep contact details for correction, but refresh server availability after conflicts.
      await refreshCalendar({ quiet: true });
      $("request-message").focus();
    } finally {
      state.busy = false;
      captcha.reset();
      $("submit-request").disabled = true;
      $("submit-request").textContent = "Send walk request ↗";
    }
  });
  function clearAdmin() {
    state.adminVersion++;
    state.admin = false;
    state.data = null;
    $("admin-dashboard").hidden = true;
    $("admin-actions").hidden = true;
    $("request-list").replaceChildren();
    $("admin-slots").replaceChildren();
    $("blocked-list").replaceChildren();
    $("admin-stats").replaceChildren();
    $("login-form").hidden = false;
  }
  function field(label, value) {
    const p = el("p");
    p.append(el("strong", label), doc.createTextNode(value || "—"));
    return p;
  }
  function actionButton(text, action, secondary = false) {
    const button = el("button", text, `button${secondary ? " secondary" : ""}`);
    button.type = "button";
    button.disabled = !!api?.preview;
    button.addEventListener("click", () => mutateAdmin(button, action));
    return button;
  }
  function renderRequests() {
    const list = $("request-list");
    list.replaceChildren();
    if (!state.data || !state.admin) return;
    const filter = $("request-filter").value;
    const requests = state.data.requests.filter(
      (r) => filter === "all" || r.status === filter,
    );
    if (!requests.length) {
      list.append(
        el("p", "All clear here. No requests in this view.", "empty"),
      );
      return;
    }
    const slots = new Map(state.data.slots.map((s) => [s.id, s]));
    for (const r of requests) {
      const card = el("article", undefined, "request-card");
      const top = el("div", undefined, "card-top");
      top.append(
        el("h3", `${r.dog_name}’s next walk`),
        el("span", r.status, `status ${r.status}`),
      );
      const slot = slots.get(r.slot_id);
      const meta = el("div", undefined, "request-meta");
      meta.append(
        field(
          "Time",
          slot
            ? `${slotLabel(slot, state.calendar.timezone)} · ${state.calendar.timezone}`
            : "Time unavailable",
        ),
        field("Neighbor", r.customer_name),
        field("Email", r.email),
        field("Phone", r.phone),
        field("Neighborhood", r.neighborhood),
      );
      card.append(top, meta);
      if (r.notes) card.append(el("p", r.notes, "request-notes"));
      const actions = el("div", undefined, "request-buttons");
      if (r.status === "pending") {
        actions.append(
          actionButton("Approve walk", () => api.review(r.id, "approved")),
          actionButton(
            "Decline request",
            () => api.review(r.id, "declined"),
            true,
          ),
        );
      }
      if (r.status === "approved")
        actions.append(
          actionButton(
            "Cancel appointment",
            () => api.review(r.id, "cancelled"),
            true,
          ),
        );
      card.append(actions);
      list.append(card);
    }
  }
  function renderAvailability() {
    const { slots, blocks, requests } = state.data;
    const c = state.calendar;
    const dayFor = (slot) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: c.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(slot.starts_at));
    const inWindow = (slot) =>
      dayFor(slot) >= c.today && dayFor(slot) <= c.last_date;
    const active = new Map(
      requests
        .filter((r) => ["pending", "approved"].includes(r.status))
        .map((r) => [r.slot_id, r.status]),
    );
    const currentSlots = slots.filter(inWindow);
    $("admin-stats").replaceChildren();
    [
      [
        requests.filter((r) => r.status === "pending").length,
        "Awaiting review",
      ],
      [
        requests.filter((r) => r.status === "approved").length,
        "Approved walks",
      ],
      [
        currentSlots.filter(
          (s) =>
            s.is_open &&
            !active.has(s.id) &&
            !blocks.some((b) => b.day === dayFor(s)) &&
            new Date(s.starts_at) > new Date(),
        ).length,
        "Available times",
      ],
    ].forEach(([number, title]) => {
      const stat = el("div", undefined, "stat");
      stat.append(el("strong", String(number)), el("span", title));
      $("admin-stats").append(stat);
    });
    $("admin-zone").textContent =
      `All dates and times use ${c.timezone}. You can manage ${dayLabel(c.today)} through ${dayLabel(c.last_date)}.`;
    doc
      .querySelectorAll('#admin-dashboard input[type="date"]')
      .forEach((input) => {
        input.min = c.today;
        input.max = c.last_date;
      });
    $("blocked-list").replaceChildren();
    const currentBlocks = blocks.filter(
      (b) => b.day >= c.today && b.day <= c.last_date,
    );
    if (!currentBlocks.length)
      $("blocked-list").append(
        el("p", "No blocked dates in this window.", "muted"),
      );
    for (const b of currentBlocks) {
      const row = el("div", undefined, "list-row");
      row.append(
        el("span", dayLabel(b.day)),
        actionButton("Unblock", () => api.blockDate(b.day, false), true),
      );
      $("blocked-list").append(row);
    }
    $("admin-slots").replaceChildren();
    if (!currentSlots.length)
      $("admin-slots").append(
        el(
          "p",
          "No walking times yet. Add your first available walk above.",
          "empty",
        ),
      );
    for (const slot of currentSlots) {
      const blocked = blocks.some((b) => b.day === dayFor(slot));
      const past = new Date(slot.starts_at) <= new Date();
      const row = el("div", undefined, "list-row");
      const label = el("div", slotLabel(slot, c.timezone));
      label.append(
        el(
          "small",
          active.get(slot.id) ||
            (blocked
              ? "Date blocked"
              : past
                ? "Past time"
                : slot.is_open
                  ? "Open"
                  : "Closed"),
        ),
      );
      row.append(label);
      if (!active.has(slot.id) && !past)
        row.append(
          actionButton(
            slot.is_open ? "Close time" : "Reopen time",
            () => api.setSlot(slot.id, !slot.is_open),
            true,
          ),
        );
      $("admin-slots").append(row);
    }
    if (api.preview)
      doc
        .querySelectorAll('#admin-dashboard button[type="submit"]')
        .forEach((button) => {
          button.disabled = true;
        });
  }
  async function loadAdmin() {
    const version = ++state.adminVersion;
    try {
      const session = await api.session();
      if (!session) {
        clearAdmin();
        message("admin-message", "Sign in to manage appointments.");
        return;
      }
      if (!(await api.isAdmin())) {
        await api.signOut();
        clearAdmin();
        message(
          "admin-message",
          "This account does not have administrator access.",
          "error",
        );
        return;
      }
      const [data, calendar] = await Promise.all([
        api.adminData(),
        api.calendar(),
      ]);
      if (version !== state.adminVersion) return;
      state.admin = true;
      state.data = data;
      state.calendar = calendar;
      $("login-form").hidden = true;
      $("admin-dashboard").hidden = false;
      $("admin-actions").hidden = false;
      message(
        "admin-message",
        api.preview
          ? "Read-only design preview · All people, requests, and times here are fictional. Changes are disabled."
          : "",
      );
      renderRequests();
      renderAvailability();
    } catch (error) {
      clearAdmin();
      throw error;
    }
  }
  async function mutateAdmin(button, action) {
    if (state.busy || !state.admin || !api || api.preview) return;
    state.busy = true;
    button.disabled = true;
    message("admin-message", "Saving…");
    try {
      const result = await action();
      await loadAdmin();
      const notification = result?.notification;
      const feedback = notification === "sent"
        ? "Saved. The customer notification was sent."
        : notification === "test_mode"
          ? "Saved. Customer email is disabled in Resend testing mode; contact the neighbor directly."
          : notification === "failed"
            ? "Saved, but the email could not be sent. Please contact the neighbor directly."
            : "Saved. For appointment changes, contact the neighbor directly to confirm.";
      message("admin-message", feedback, "success");
    } catch (error) {
      message("admin-message", readableError(error), "error");
    } finally {
      state.busy = false;
      button.disabled = false;
    }
  }
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!api || state.busy) return;
    const button = event.currentTarget.querySelector("button");
    const data = new win.FormData(event.currentTarget);
    button.disabled = true;
    state.busy = true;
    message("admin-message", "Signing in…");
    try {
      await api.signIn(
        String(data.get("email")).trim(),
        String(data.get("password")),
      );
      $("login-form").reset();
      await loadAdmin();
    } catch (error) {
      clearAdmin();
      message("admin-message", readableError(error), "error");
    } finally {
      button.disabled = false;
      state.busy = false;
    }
  });
  $("sign-out").addEventListener("click", async () => {
    try {
      await api.signOut();
      clearAdmin();
      message("admin-message", "You’ve signed out.");
    } catch (error) {
      message("admin-message", readableError(error), "error");
    }
  });
  $("admin-refresh").addEventListener("click", async () => {
    try {
      await loadAdmin();
    } catch (error) {
      clearAdmin();
      message("admin-message", readableError(error), "error");
    }
  });
  $("request-filter").addEventListener("change", renderRequests);
  for (const [tab, panel, otherTab, otherPanel] of [
    [
      "requests-tab",
      "requests-panel",
      "availability-tab",
      "availability-panel",
    ],
    [
      "availability-tab",
      "availability-panel",
      "requests-tab",
      "requests-panel",
    ],
  ]) {
    $(tab).addEventListener("click", () => {
      $(tab).classList.add("selected");
      $(tab).setAttribute("aria-pressed", "true");
      $(panel).hidden = false;
      $(otherTab).classList.remove("selected");
      $(otherTab).setAttribute("aria-pressed", "false");
      $(otherPanel).hidden = true;
    });
  }
  $("add-slot-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const data = new win.FormData(event.currentTarget);
    mutateAdmin(event.currentTarget.querySelector("button"), () =>
      api.addSlot(data.get("day"), data.get("time")),
    );
  });
  $("block-date-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const data = new win.FormData(event.currentTarget);
    mutateAdmin(event.currentTarget.querySelector("button"), () =>
      api.blockDate(data.get("day"), true),
    );
  });
  async function route() {
    const admin = win.location.hash === "#admin";
    $("public-view").hidden = admin;
    $("admin-view").hidden = !admin;
    if (admin) {
      if (!api) {
        message(
          "admin-message",
          "Administrator sign-in is unavailable until Supabase is configured. See the setup guide.",
        );
        $("login-form").querySelector("button").disabled = true;
        return;
      }
      try {
        await loadAdmin();
      } catch (error) {
        clearAdmin();
        message("admin-message", readableError(error), "error");
      }
    } else {
      await refreshCalendar();
    }
  }
  win.addEventListener("hashchange", route);
  const subscription = api?.onAuthChange((session) => {
    // No Supabase calls inside the auth callback (avoids the client's auth lock).
    if (!session) {
      clearAdmin();
      if (win.location.hash === "#admin")
        message("admin-message", "Your session ended. Please sign in again.");
    }
  });
  // Refresh on return to tab to avoid showing stale bookable times. No customer data in local storage.
  const onVisible = () => {
    if (doc.visibilityState === "visible" && win.location.hash !== "#admin")
      refreshCalendar({ quiet: true });
  };
  doc.addEventListener("visibilitychange", onVisible);
  $("year").textContent = String(new Date().getFullYear());
  const ready = route();
  return {
    ready,
    state,
    refreshCalendar,
    destroy() {
      win.removeEventListener("hashchange", route);
      doc.removeEventListener("visibilitychange", onVisible);
      subscription?.unsubscribe();
    },
  };
}
