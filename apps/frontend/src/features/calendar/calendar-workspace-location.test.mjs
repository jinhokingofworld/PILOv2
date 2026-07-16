import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCalendarWorkspaceLocation, getCalendarScrollOffset } from "./calendar-workspace-location.ts";

test("Calendar는 선택 날짜와 grid scroll ratio를 복원한다", async () => {
  const location = createCalendarWorkspaceLocation("2026-07-16", { clientHeight: 300, clientWidth: 400, scrollHeight: 900, scrollLeft: 300, scrollTop: 300, scrollWidth: 1000 });
  assert.equal(location.context.selectedDate, "2026-07-16");
  assert.equal(location.route.search, "?date=2026-07-16");
  assert.deepEqual(location.viewport, { kind: "element", key: "calendar-grid", xRatio: 0.5, yRatio: 0.5 });
  assert.deepEqual(getCalendarScrollOffset(location.viewport, { clientHeight: 300, clientWidth: 400, scrollHeight: 900, scrollWidth: 1000 }), { left: 300, top: 300 });
  const adapter = await readFile(new URL("./calendar-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /onSelectDate/);
  const host = await readFile(new URL("./components/calendar-panel.tsx", import.meta.url), "utf8");
  assert.match(host, /CalendarWorkspaceLocationAdapter/);
  assert.match(host, /calendarGridRef/);
});
