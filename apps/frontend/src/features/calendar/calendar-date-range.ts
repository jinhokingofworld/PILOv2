const calendarGridWeekCount = 6;
const calendarWeekdayCount = 7;

function padDatePart(value: number) {
  return value.toString().padStart(2, "0");
}

function addCalendarDays(date: Date, dayOffset: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset
  );
}

export function formatCalendarDate(date: Date) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate())
  ].join("-");
}

export function getCalendarMonthGridRange(monthDate: Date) {
  const monthStartDate = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth(),
    1
  );
  const gridStartDate = addCalendarDays(
    monthStartDate,
    -monthStartDate.getDay()
  );
  const gridEndDate = addCalendarDays(
    gridStartDate,
    calendarGridWeekCount * calendarWeekdayCount - 1
  );

  return {
    start: formatCalendarDate(gridStartDate),
    end: formatCalendarDate(gridEndDate)
  };
}

export const getCalendarMonthRange = getCalendarMonthGridRange;
