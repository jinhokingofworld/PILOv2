import type { CalendarEvent } from "@/features/calendar/types";

export function getCalendarRangeDates(anchorDate: Date, dayCount: number) {
  const rangeStartDate = new Date(anchorDate);
  rangeStartDate.setDate(anchorDate.getDate() - anchorDate.getDay());

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(rangeStartDate);
    date.setDate(rangeStartDate.getDate() + index);
    return date;
  });
}

export function formatCalendarRangeTitle(dates: Date[]) {
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  if (!firstDate || !lastDate) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    month: "long"
  });

  return `${formatter.format(firstDate)} – ${formatter.format(lastDate)}`;
}

export function formatRelativeTimeFromNow(value: string) {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return "-";
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (diffMinutes < 1) {
    return "방금 전";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}일 전`;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    month: "short"
  }).format(new Date(timestamp));
}

export function isCalendarEventOnDate(event: CalendarEvent, date: string) {
  return event.startDate <= date && event.endDate >= date;
}

export function getCappedProgressPercent(value: number, maxValue: number) {
  if (maxValue <= 0) {
    return "0%";
  }

  return `${Math.min(100, Math.round((value / maxValue) * 100))}%`;
}

export function isSameCalendarDate(firstDate: Date, secondDate: Date) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

export function formatCalendarDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
