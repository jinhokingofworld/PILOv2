"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { pageCursorTargetAttributes } from "@/shared/page-cursor/page-cursor-target";
import type { HomeWeekCalendarEventsState } from "../hooks/use-home-dashboard-data";
import {
  formatCalendarDate,
  formatCalendarRangeTitle,
  isCalendarEventOnDate,
  isSameCalendarDate
} from "../utils/home-date";

const calendarWeekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

export function CalendarCard({
  calendarDates,
  calendarEventsState,
  today
}: {
  calendarDates: Date[];
  calendarEventsState: HomeWeekCalendarEventsState;
  today: Date;
}) {
  return (
    <div className="h-full min-h-[430px] overflow-hidden">
      <ReadonlyCalendar
        calendarDates={calendarDates}
        calendarEventsState={calendarEventsState}
        today={today}
      />
    </div>
  );
}

function ReadonlyCalendar({
  calendarDates,
  calendarEventsState,
  today
}: {
  calendarDates: Date[];
  calendarEventsState: HomeWeekCalendarEventsState;
  today: Date;
}) {
  const router = useRouter();
  const {
    events: calendarEvents,
    error: calendarEventsError,
    status: calendarEventsStatus
  } = calendarEventsState;
  const calendarTitle = formatCalendarRangeTitle(calendarDates);
  const todayValue = formatCalendarDate(today);
  const todayEvents = calendarEvents.filter((event) =>
    isCalendarEventOnDate(event, todayValue)
  );
  const visibleTodayEvents = todayEvents.slice(0, 3);

  return (
    <Card
      {...pageCursorTargetAttributes({
        id: "calendar",
        label: "캘린더",
        type: "home_card"
      })}
      className="relative h-full min-h-0 overflow-hidden rounded-[15px] border-[#e7e9ee] bg-white shadow-[0_10px_30px_rgba(32,33,36,0.05)]"
      size="sm"
    >
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-5">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-[#e7e9ee] bg-[#f6f7f9] text-[#6b6f78]">
            <CalendarDays className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold tracking-[-0.01em] text-[#202124]">
              이번 주 · 다음 주 일정
            </p>
            <p className="truncate text-[12px] text-[#6b6f78]">{calendarTitle}</p>
          </div>
          {calendarEventsStatus === "error" ? (
            <span
              className="truncate text-[12px] text-destructive"
              title={calendarEventsError?.message}
            >
              일정 불러오기 실패
            </span>
          ) : null}
          <Button
            aria-label="캘린더로 이동"
            className="ml-auto"
            onClick={() => router.push("/calendar")}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="grid h-full min-w-[720px] grid-cols-7 grid-rows-2 gap-2">
            {calendarDates.map((date) => {
              const isToday = isSameCalendarDate(date, today);
              const dateValue = formatCalendarDate(date);
              const dateEvents = calendarEvents.filter((event) =>
                isCalendarEventOnDate(event, dateValue)
              );
              const visibleEvents = dateEvents.slice(0, 3);
              const hiddenEventCount = Math.max(
                0,
                dateEvents.length - visibleEvents.length
              );

              return (
                <button
                  {...pageCursorTargetAttributes({
                    id: dateValue,
                    label: dateValue,
                    type: "home_calendar_date"
                  })}
                  key={date.toISOString()}
                  aria-label={`${dateValue} 캘린더로 이동`}
                  className={[
                    "flex min-h-[92px] min-w-0 flex-col items-stretch gap-1.5 rounded-[10px] border border-[#e7e9ee] bg-[#fbfbfc] p-2 text-left transition hover:border-[#d6d9e0] hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    isToday ? "border-[#6c75f5] bg-[#f7f7ff]" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => router.push(`/calendar?date=${dateValue}`)}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-medium leading-none text-[#6b6f78]">
                      {calendarWeekdayLabels[date.getDay()]}
                    </span>
                    <span
                      className={
                        isToday
                          ? "flex size-6 items-center justify-center rounded-full bg-[#5963e8] text-[12px] font-semibold text-white"
                          : "flex size-6 items-center justify-center text-[12px] font-medium text-[#202124]"
                      }
                    >
                      {date.getDate()}
                    </span>
                  </span>
                  <span className="flex min-h-0 flex-1 flex-col justify-center gap-1">
                    {visibleEvents.map((event) => (
                      <span
                        {...pageCursorTargetAttributes({
                          id: event.id,
                          label: event.title,
                          type: "home_calendar_event"
                        })}
                        key={event.id}
                        className="block min-w-0 truncate rounded-[5px] px-1.5 py-1 text-[11px] font-medium leading-none text-white"
                        style={{ backgroundColor: event.color }}
                      >
                        {event.isAllDay ? "종일" : event.startTime} {event.title}
                      </span>
                    ))}
                    {hiddenEventCount > 0 ? (
                      <span
                        aria-label={`${hiddenEventCount}개 일정 더 있음`}
                        className="self-center rounded-full bg-[#eef0f4] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[#656972]"
                      >
                        +{hiddenEventCount}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <section className="mt-3 grid shrink-0 gap-2 border-t border-[#eceef2] pt-3 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-center">
          <div>
            <p className="text-[13px] font-semibold text-[#202124]">오늘 일정</p>
            <p className="mt-0.5 text-[12px] text-[#6b6f78]">{todayValue}</p>
          </div>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            {calendarEventsStatus === "loading" ? (
              <p className="text-[12px] text-[#6b6f78]">일정을 불러오는 중입니다</p>
            ) : calendarEventsStatus === "error" ? (
              <p className="text-[12px] text-destructive">
                오늘 일정을 불러오지 못했습니다
              </p>
            ) : visibleTodayEvents.length > 0 ? (
              <>
                {visibleTodayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex min-w-0 max-w-[220px] items-center gap-2 rounded-[8px] bg-[#f8f9fb] px-2.5 py-2"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: event.color }}
                    />
                    <span className="min-w-0 truncate text-[12px] text-[#202124]">
                      {event.isAllDay ? "종일" : event.startTime} {event.title}
                    </span>
                  </div>
                ))}
                {todayEvents.length > visibleTodayEvents.length ? (
                  <span className="shrink-0 text-[12px] font-medium text-[#6b6f78]">
                    +{todayEvents.length - visibleTodayEvents.length}
                  </span>
                ) : null}
              </>
            ) : (
              <p className="text-[12px] text-[#6b6f78]">
                오늘 예정된 일정이 없습니다
              </p>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
