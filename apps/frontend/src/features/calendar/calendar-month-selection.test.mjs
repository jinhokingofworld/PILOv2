import assert from "node:assert/strict";
import test from "node:test";

import {
  CALENDAR_MAX_YEAR,
  CALENDAR_MIN_YEAR,
  createCalendarMonthDate,
  isCalendarMonthInRange
} from "./calendar-month-selection.ts";
import { getCalendarMonthGridRange } from "./calendar-date-range.ts";

test("월 선택 범위는 1900년부터 2100년까지다", () => {
  assert.equal(CALENDAR_MIN_YEAR, 1900);
  assert.equal(CALENDAR_MAX_YEAR, 2100);
  assert.equal(createCalendarMonthDate(1899, 12), null);
  assert.equal(createCalendarMonthDate(2101, 1), null);
  assert.equal(isCalendarMonthInRange(new Date(1899, 11, 1)), false);
  assert.equal(isCalendarMonthInRange(new Date(2101, 0, 1)), false);
});

test("월 선택은 요청한 4자리 연도를 그대로 생성한다", () => {
  const firstMonth = createCalendarMonthDate(1900, 1);
  const lastMonth = createCalendarMonthDate(2100, 12);

  assert.equal(firstMonth?.getFullYear(), 1900);
  assert.equal(firstMonth?.getMonth(), 0);
  assert.equal(firstMonth?.getDate(), 1);
  assert.equal(lastMonth?.getFullYear(), 2100);
  assert.equal(lastMonth?.getMonth(), 11);
  assert.equal(lastMonth?.getDate(), 1);
});

test("지원 범위 경계 월의 42일 조회 범위도 YYYY-MM-DD 형식을 유지한다", () => {
  const cases = [
    [createCalendarMonthDate(1900, 1), "1899-12-31", "1900-02-10"],
    [createCalendarMonthDate(2100, 12), "2100-11-28", "2101-01-08"]
  ];

  for (const [monthDate, expectedStart, expectedEnd] of cases) {
    assert.ok(monthDate);
    const range = getCalendarMonthGridRange(monthDate);
    assert.match(range.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(range.end, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(range.start, expectedStart);
    assert.equal(range.end, expectedEnd);
  }
});
