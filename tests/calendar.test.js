import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  calendarCells,
  dayLabel,
  monthFromKey,
  moveMonth,
  timeLabel,
} from "../src/calendar.js";

test("30 calendar days cross months, years, leap days and daylight saving without drift", () => {
  assert.equal(addDays("2026-12-20", 29), "2027-01-18");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-07", 2), "2026-03-09");
  assert.equal(moveMonth("2026-12-01", 1), "2027-01-01");
  assert.equal(monthFromKey("2026-11-30"), "2026-11-01");
});
test("calendar has weekday offsets and only allows available dates inside inclusive window", () => {
  const cells = calendarCells("2026-11-01", "2026-11-10", "2026-12-09", [
    { day: "2026-11-09" },
    { day: "2026-11-10" },
    { day: "2026-11-30" },
  ]);
  assert.equal(cells.length, 30);
  assert.deepEqual(
    cells.filter((c) => c?.available).map((c) => c.key),
    ["2026-11-10", "2026-11-30"],
  );
  const december = calendarCells("2026-12-01", "2026-11-10", "2026-12-09", [
    { day: "2026-12-09" },
    { day: "2026-12-10" },
  ]);
  assert.equal(december[0], null);
  assert.equal(december[1], null);
  assert.deepEqual(
    december.filter((c) => c?.available).map((c) => c.key),
    ["2026-12-09"],
  );
});
test("date labels stay stable and time labels use service timezone", () => {
  assert.equal(dayLabel("2026-11-10"), "Tuesday, November 10");
  assert.equal(
    timeLabel("2026-11-10T16:00:00Z", "America/Chicago"),
    "10:00 AM",
  );
  assert.equal(
    timeLabel("2026-07-10T16:00:00Z", "America/Chicago"),
    "11:00 AM",
  );
});
