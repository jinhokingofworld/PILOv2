export const CALENDAR_MIN_YEAR = 1900;
export const CALENDAR_MAX_YEAR = 2100;

export function isCalendarMonthInRange(date: Date) {
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const year = date.getFullYear();
  return year >= CALENDAR_MIN_YEAR && year <= CALENDAR_MAX_YEAR;
}

export function createCalendarMonthDate(year: number, month: number) {
  if (
    !Number.isInteger(year) ||
    year < CALENDAR_MIN_YEAR ||
    year > CALENDAR_MAX_YEAR ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  const date = new Date(0);
  date.setFullYear(year, month - 1, 1);
  date.setHours(0, 0, 0, 0);
  return date;
}
