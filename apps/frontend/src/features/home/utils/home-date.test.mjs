import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCalendarDate,
  formatCalendarRangeTitle,
  getCalendarRangeDates
} from "./home-date.ts";

test("토요일 기준 이번 주 일요일부터 다음 주 토요일까지 표시한다", () => {
  const dates = getCalendarRangeDates(new Date(2026, 6, 25), 14);

  assert.equal(formatCalendarDate(dates[0]), "2026-07-19");
  assert.equal(formatCalendarDate(dates[13]), "2026-08-01");
  assert.equal(formatCalendarRangeTitle(dates), "7월 19일 – 8월 1일");
});
