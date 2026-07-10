"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { HomeWeekCalendarEventsState } from "../hooks/use-home-dashboard-data";
import {
  formatCalendarDate,
  formatCalendarRangeMonthTitle,
  isCalendarEventOnDate,
  isSameCalendarDate
} from "../utils/home-date";
import { CalendarBackground } from "./home-backgrounds";

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
    <div className="h-full min-h-0 overflow-hidden 2xl:col-span-2 2xl:col-start-2 2xl:row-start-1">
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
  const calendarTitle = formatCalendarRangeMonthTitle(calendarDates);

  return (
    <>
      <Card
        className="relative h-full min-h-0 border-[#B7DCD7] bg-[#F4FBFA] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]"
        size="sm"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <CalendarBackground />
        </div>
        <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
              <CalendarDays className="size-4" />
            </span>
            <p className="text-sm font-semibold text-foreground">{calendarTitle}</p>
            {calendarEventsStatus === "error" ? (
              <span
                className="truncate text-xs text-destructive"
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
            <div className="grid h-full min-w-[44rem] grid-cols-7 grid-rows-2 gap-1.5">
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
                    key={date.toISOString()}
                    aria-label={`${dateValue} 캘린더로 이동`}
                    className={[
                      "flex min-h-0 min-w-0 flex-col items-stretch justify-between gap-1 rounded-md border bg-background/80 p-1.5 text-left text-xs shadow-sm transition hover:bg-muted/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      isToday ? "border-primary text-primary" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => router.push(`/calendar?date=${dateValue}`)}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className="text-[0.65rem] font-medium leading-none text-muted-foreground">
                        {calendarWeekdayLabels[date.getDay()]}
                      </span>
                      <span
                        className={
                          isToday
                            ? "flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
                            : "flex size-5 items-center justify-center font-medium"
                        }
                      >
                        {date.getDate()}
                      </span>
                    </span>
                    <span className="flex min-h-0 flex-1 flex-col justify-center gap-1">
                      {visibleEvents.length > 0 ? (
                        <>
                          {visibleEvents.map((event) => (
                            <span
                              key={event.id}
                              className="block min-w-0 truncate rounded-sm px-1 py-0.5 text-center text-[0.65rem] leading-none text-white"
                              style={{ backgroundColor: event.color }}
                            >
                              {event.isAllDay ? "종일" : event.startTime}{" "}
                              {event.title}
                            </span>
                          ))}
                          {hiddenEventCount > 0 ? (
                            <span
                              aria-label={`${hiddenEventCount}개 일정 더 있음`}
                              className="self-center rounded-full border border-[#B7DCD7] bg-[#2EC4B6]/10 px-1.5 py-0.5 text-[0.6rem] font-semibold leading-none text-[#0F766E]"
                            >
                              +{hiddenEventCount}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
