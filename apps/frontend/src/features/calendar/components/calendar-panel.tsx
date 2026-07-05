"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCalendarDate,
  useCalendarMonthEvents
} from "@/features/calendar/hooks/use-calendar-month-events";
import { calendarNavigation } from "@/features/calendar/navigation";

const calendarSections = [
  {
    id: "month",
    title: "월간 일정",
    description: "팀 전체 일정 흐름을 월 단위로 확인합니다."
  },
  {
    id: "today",
    title: "오늘 일정",
    description: "오늘 진행할 일정과 선택 날짜의 작업을 확인합니다."
  },
  {
    id: "new",
    title: "새 일정",
    description: "새 일정을 등록합니다."
  }
];

const ACCESS_TOKEN_STORAGE_KEY = "pilo_access_token";
const DEFAULT_WORKSPACE_ID =
  process.env.NEXT_PUBLIC_PILO_WORKSPACE_ID ?? "pilo-local-workspace";

function readStoredAccessToken() {
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch (error) {
    return "";
  }
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function shiftMonth(date: Date, monthOffset: number) {
  return new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
}

function getEventTimeLabel(event: {
  isAllDay: boolean;
  startTime: string | null;
  endTime: string | null;
}) {
  if (event.isAllDay) {
    return "종일";
  }

  return [event.startTime, event.endTime].filter(Boolean).join(" - ");
}

export function CalendarPanel() {
  const [accessToken, setAccessToken] = useState("");
  const [monthDate, setMonthDate] = useState(() => new Date());
  const workspaceId = DEFAULT_WORKSPACE_ID;
  const monthLabel = formatMonthLabel(monthDate);
  const today = useMemo(() => formatCalendarDate(new Date()), []);
  const calendarEvents = useCalendarMonthEvents({
    accessToken,
    monthDate,
    workspaceId
  });
  const isReadyToLoad = Boolean(workspaceId.trim() && accessToken.trim());
  const visibleEvents = calendarEvents.events.slice(0, 6);
  const todayEvents = calendarEvents.events.filter(
    (event) => event.startDate <= today && event.endDate >= today
  );
  const needsSignIn = !accessToken.trim();
  const connectionLabel =
    needsSignIn
      ? "로그인 필요"
      : calendarEvents.status === "loading"
      ? "조회 중"
      : calendarEvents.status === "success"
        ? "최신 일정"
        : calendarEvents.status === "error"
          ? "불러오기 실패"
          : "대기";

  useEffect(() => {
    setAccessToken(readStoredAccessToken());
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/20 bg-primary text-primary-foreground">
        <CardHeader>
          <CardTitle>{calendarNavigation.title} 시작 영역</CardTitle>
          <CardDescription className="text-primary-foreground/75">
            {calendarNavigation.label}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm leading-6 text-primary-foreground/80">
            {calendarNavigation.description}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <Card id="month">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" />
              {calendarSections[0].title}
            </CardTitle>
            <CardDescription>
              {calendarEvents.range.start} - {calendarEvents.range.end}
            </CardDescription>
            <CardAction className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="이전 달"
                onClick={() => setMonthDate((date) => shiftMonth(date, -1))}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="다음 달"
                onClick={() => setMonthDate((date) => shiftMonth(date, 1))}
              >
                <ChevronRight />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-lg border bg-muted/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{monthLabel}</span>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                    {connectionLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {calendarEvents.events.length}개 일정
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isReadyToLoad || calendarEvents.status === "loading"}
                  onClick={() => void calendarEvents.reload()}
                >
                  {calendarEvents.status === "loading" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  새로고침
                </Button>
              </div>

              {needsSignIn ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  일정을 보려면 로그인이 필요합니다.
                </p>
              ) : null}
              {calendarEvents.error ? (
                <p className="mt-2 text-sm text-destructive">
                  일정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
                </p>
              ) : null}
            </div>

            {calendarEvents.status === "loading" ? (
              <div className="grid gap-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : visibleEvents.length > 0 ? (
              <ul className="grid gap-2" aria-label="월간 일정 목록">
                {visibleEvents.map((event) => (
                  <li
                    key={event.id}
                    className="flex gap-3 rounded-lg border bg-background p-3"
                  >
                    <span
                      className="mt-1 size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: event.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-medium">
                          {event.title}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {getEventTimeLabel(event)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.startDate}
                        {event.endDate !== event.startDate
                          ? ` - ${event.endDate}`
                          : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                {isReadyToLoad
                  ? "조회된 일정이 없습니다."
                  : "로그인 후 일정을 불러옵니다."}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card id="today">
            <CardHeader>
              <CardTitle>{calendarSections[1].title}</CardTitle>
              <CardDescription>{today}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {todayEvents.length}개 일정
              </p>
            </CardContent>
          </Card>

          <Card id="new">
            <CardHeader>
              <CardTitle>{calendarSections[2].title}</CardTitle>
              <CardDescription>{calendarSections[2].description}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>
    </div>
  );
}
