"use client";

import {
  CalendarClock,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { createCalendarApiClient } from "@/features/calendar/api/client";
import {
  formatCalendarDate,
  useCalendarMonthEvents
} from "@/features/calendar/hooks/use-calendar-month-events";
import { calendarNavigation } from "@/features/calendar/navigation";
import type {
  CalendarEvent,
  CreateCalendarEventInput
} from "@/features/calendar/types";

type CalendarFormState = {
  title: string;
  description: string;
  color: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
};

type CalendarSheetMode =
  | {
      type: "create";
    }
  | {
      type: "edit";
      event: CalendarEvent;
    };

const ACCESS_TOKEN_STORAGE_KEY = "pilo_access_token";
const DEFAULT_WORKSPACE_ID =
  process.env.NEXT_PUBLIC_PILO_WORKSPACE_ID ?? "pilo-local-workspace";
const DEFAULT_EVENT_COLOR = "#3B82F6";
const calendarGridCellCount = 42;
const calendarWeekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const calendarColorOptions = [
  { label: "파랑", value: "#3B82F6" },
  { label: "초록", value: "#22C55E" },
  { label: "보라", value: "#8B5CF6" },
  { label: "분홍", value: "#EC4899" },
  { label: "주황", value: "#F97316" },
  { label: "회색", value: "#64748B" }
];

function readStoredAccessToken() {
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch (error) {
    return "";
  }
}

function startOfCalendarMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addCalendarDays(date: Date, dayOffset: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset);
}

function shiftMonth(date: Date, monthOffset: number) {
  return new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
}

function getCalendarGridDates(monthDate: Date) {
  const monthStartDate = startOfCalendarMonth(monthDate);
  const gridStartDate = addCalendarDays(
    monthStartDate,
    -monthStartDate.getDay()
  );

  return Array.from({ length: calendarGridCellCount }, (_, index) =>
    formatCalendarDate(addCalendarDays(gridStartDate, index))
  );
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function formatDateLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return "날짜 미지정";
  }

  const [year, month, day] = date.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

function formatCellDay(date: string) {
  return String(Number(date.slice(-2)));
}

function isDateInMonth(date: string, monthDate: Date) {
  const monthKey = [
    monthDate.getFullYear(),
    String(monthDate.getMonth() + 1).padStart(2, "0")
  ].join("-");

  return date.startsWith(monthKey);
}

function getEventTimeLabel(event: Pick<CalendarEvent, "isAllDay" | "startTime" | "endTime">) {
  if (event.isAllDay) {
    return "종일";
  }

  return [event.startTime, event.endTime].filter(Boolean).join(" - ");
}

function getEventDateLabel(event: CalendarEvent) {
  if (event.startDate === event.endDate) {
    return formatDateLabel(event.startDate);
  }

  return `${formatDateLabel(event.startDate)} - ${formatDateLabel(event.endDate)}`;
}

function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent) {
  if (a.isAllDay !== b.isAllDay) {
    return a.isAllDay ? -1 : 1;
  }

  const timeCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
  if (timeCompare !== 0) {
    return timeCompare;
  }

  return a.title.localeCompare(b.title);
}

function getEventsForCalendarDate(events: CalendarEvent[], date: string) {
  return events
    .filter((event) => event.startDate <= date && event.endDate >= date)
    .sort(compareCalendarEvents);
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function createDefaultFormState(date: string): CalendarFormState {
  return {
    title: "",
    description: "",
    color: DEFAULT_EVENT_COLOR,
    isAllDay: false,
    startDate: date,
    endDate: date,
    startTime: "09:00",
    endTime: ""
  };
}

function createFormStateFromEvent(event: CalendarEvent): CalendarFormState {
  return {
    title: event.title,
    description: event.description ?? "",
    color: event.color,
    isAllDay: event.isAllDay,
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime ?? "09:00",
    endTime: event.endTime ?? ""
  };
}

function buildCalendarEventInput(formState: CalendarFormState) {
  const title = formState.title.trim();
  const description = formState.description.trim();

  if (!title) {
    return { error: "일정 제목을 입력해주세요.", input: null };
  }

  if (!formState.startDate || !formState.endDate) {
    return { error: "시작일과 종료일을 입력해주세요.", input: null };
  }

  if (formState.endDate < formState.startDate) {
    return { error: "종료일은 시작일보다 빠를 수 없습니다.", input: null };
  }

  if (!formState.isAllDay && !formState.startTime) {
    return { error: "시간 일정은 시작 시간이 필요합니다.", input: null };
  }

  if (
    !formState.isAllDay &&
    formState.startDate === formState.endDate &&
    formState.endTime &&
    formState.endTime <= formState.startTime
  ) {
    return { error: "종료 시간은 시작 시간보다 늦어야 합니다.", input: null };
  }

  const input: CreateCalendarEventInput = {
    title,
    description: description || null,
    color: formState.color,
    isAllDay: formState.isAllDay,
    startDate: formState.startDate,
    endDate: formState.endDate
  };

  if (formState.isAllDay) {
    input.startTime = null;
    input.endTime = null;
  } else {
    input.startTime = formState.startTime;
    if (formState.endTime) {
      input.endTime = formState.endTime;
    }
  }

  return { error: null, input };
}

function errorMessageFromUnknown(error: unknown) {
  return error instanceof Error
    ? error.message
    : "일정을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function CalendarEventSheet({
  formError,
  formState,
  isSubmitting,
  mode,
  onClose,
  onDelete,
  onFormChange,
  onSubmit
}: {
  formError: string | null;
  formState: CalendarFormState;
  isSubmitting: boolean;
  mode: CalendarSheetMode | null;
  onClose: () => void;
  onDelete: () => void;
  onFormChange: <Field extends keyof CalendarFormState>(
    field: Field,
    value: CalendarFormState[Field]
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isEditMode = mode?.type === "edit";

  return (
    <Sheet open={Boolean(mode)} onOpenChange={(open) => !open && onClose()}>
      {mode ? (
        <SheetContent className="w-full sm:max-w-lg">
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
            <SheetHeader>
              <SheetTitle>
                {isEditMode ? "일정 수정" : "새 일정"}
              </SheetTitle>
              <SheetDescription>
                {formatDateLabel(formState.startDate)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-2">
              <label className="grid gap-1.5 text-sm font-medium">
                제목
                <Input
                  value={formState.title}
                  maxLength={255}
                  placeholder="일정 제목"
                  onChange={(event) =>
                    onFormChange("title", event.currentTarget.value)
                  }
                />
              </label>

              <label className="grid gap-1.5 text-sm font-medium">
                설명
                <textarea
                  className="min-h-24 w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={formState.description}
                  placeholder="메모를 남겨둘 수 있습니다"
                  onChange={(event) =>
                    onFormChange("description", event.currentTarget.value)
                  }
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm font-medium">
                <span>종일 일정</span>
                <input
                  type="checkbox"
                  checked={formState.isAllDay}
                  className="size-4"
                  onChange={(event) =>
                    onFormChange("isAllDay", event.currentTarget.checked)
                  }
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-medium">
                  시작일
                  <Input
                    type="date"
                    value={formState.startDate}
                    onChange={(event) =>
                      onFormChange("startDate", event.currentTarget.value)
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  종료일
                  <Input
                    type="date"
                    min={formState.startDate || undefined}
                    value={formState.endDate}
                    onChange={(event) =>
                      onFormChange("endDate", event.currentTarget.value)
                    }
                  />
                </label>
              </div>

              {!formState.isAllDay ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-medium">
                    시작 시간
                    <Input
                      type="time"
                      value={formState.startTime}
                      onChange={(event) =>
                        onFormChange("startTime", event.currentTarget.value)
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    종료 시간
                    <Input
                      type="time"
                      value={formState.endTime}
                      onChange={(event) =>
                        onFormChange("endTime", event.currentTarget.value)
                      }
                    />
                  </label>
                </div>
              ) : null}

              <div className="grid gap-2">
                <span className="text-sm font-medium">색상</span>
                <div className="flex flex-wrap gap-2">
                  {calendarColorOptions.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      aria-label={color.label}
                      aria-pressed={formState.color === color.value}
                      className={classNames(
                        "size-7 rounded-full border border-border ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        formState.color === color.value &&
                          "ring-2 ring-ring ring-offset-2"
                      )}
                      style={{ backgroundColor: color.value }}
                      onClick={() => onFormChange("color", color.value)}
                    />
                  ))}
                </div>
              </div>

              {formError ? (
                <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </p>
              ) : null}
            </div>

            <SheetFooter className="border-t">
              {isEditMode ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isSubmitting}
                  onClick={onDelete}
                >
                  <Trash2 />
                  삭제
                </Button>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={isSubmitting}
                  onClick={onClose}
                >
                  취소
                </Button>
                <Button type="submit" className="flex-1" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                  {isEditMode ? "저장" : "등록"}
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

export function CalendarPanel() {
  const [accessToken, setAccessToken] = useState("");
  const [monthDate, setMonthDate] = useState(() =>
    startOfCalendarMonth(new Date())
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    formatCalendarDate(new Date())
  );
  const [sheetMode, setSheetMode] = useState<CalendarSheetMode | null>(null);
  const [formState, setFormState] = useState(() =>
    createDefaultFormState(formatCalendarDate(new Date()))
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const workspaceId = DEFAULT_WORKSPACE_ID;
  const monthLabel = formatMonthLabel(monthDate);
  const today = useMemo(() => formatCalendarDate(new Date()), []);
  const normalizedAccessToken = accessToken.trim();
  const calendarEvents = useCalendarMonthEvents({
    accessToken: normalizedAccessToken,
    monthDate,
    workspaceId
  });
  const calendarClient = useMemo(
    () => createCalendarApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const gridDates = useMemo(() => getCalendarGridDates(monthDate), [monthDate]);
  const eventsByDate = useMemo(
    () =>
      new Map(
        gridDates.map((date) => [
          date,
          getEventsForCalendarDate(calendarEvents.events, date)
        ])
      ),
    [calendarEvents.events, gridDates]
  );
  const selectedDateEvents = useMemo(
    () => getEventsForCalendarDate(calendarEvents.events, selectedDate),
    [calendarEvents.events, selectedDate]
  );
  const needsSignIn = !normalizedAccessToken;
  const isLoading = calendarEvents.status === "loading";
  const canUseCalendar = Boolean(workspaceId.trim() && normalizedAccessToken);
  const selectedDateLabel =
    selectedDate === today ? "오늘 일정" : "선택 날짜 일정";

  useEffect(() => {
    function syncAccessToken() {
      setAccessToken(readStoredAccessToken());
    }

    syncAccessToken();
    window.addEventListener("storage", syncAccessToken);
    window.addEventListener("focus", syncAccessToken);

    return () => {
      window.removeEventListener("storage", syncAccessToken);
      window.removeEventListener("focus", syncAccessToken);
    };
  }, []);

  const goToMonth = useCallback((nextMonthDate: Date) => {
    const nextMonthStart = startOfCalendarMonth(nextMonthDate);
    setMonthDate(nextMonthStart);
    setSelectedDate(formatCalendarDate(nextMonthStart));
  }, []);

  const goToToday = useCallback(() => {
    const now = new Date();
    setMonthDate(startOfCalendarMonth(now));
    setSelectedDate(formatCalendarDate(now));
  }, []);

  const openCreateSheet = useCallback((date: string) => {
    setFormState(createDefaultFormState(date));
    setFormError(null);
    setSheetMode({ type: "create" });
  }, []);

  const openEditSheet = useCallback((event: CalendarEvent) => {
    setFormState(createFormStateFromEvent(event));
    setFormError(null);
    setSheetMode({ type: "edit", event });
  }, []);

  const closeSheet = useCallback(() => {
    if (!isSubmitting) {
      setSheetMode(null);
      setFormError(null);
    }
  }, [isSubmitting]);

  const updateFormField = useCallback(
    <Field extends keyof CalendarFormState>(
      field: Field,
      value: CalendarFormState[Field]
    ) => {
      setFormState((currentFormState) => {
        const nextFormState = {
          ...currentFormState,
          [field]: value
        };

        if (
          field === "startDate" &&
          typeof value === "string" &&
          nextFormState.endDate < value
        ) {
          nextFormState.endDate = value;
        }

        return nextFormState;
      });
    },
    []
  );

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sheetMode) return;

    if (!canUseCalendar) {
      setFormError("일정을 저장하려면 로그인이 필요합니다.");
      return;
    }

    const result = buildCalendarEventInput(formState);
    if (result.error || !result.input) {
      setFormError(result.error);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (sheetMode.type === "create") {
        await calendarClient.createEvent(workspaceId, result.input);
      } else {
        await calendarClient.updateEvent(
          workspaceId,
          sheetMode.event.id,
          result.input
        );
      }

      setSheetMode(null);
      await calendarEvents.reload();
    } catch (submitError) {
      setFormError(errorMessageFromUnknown(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteEvent() {
    if (sheetMode?.type !== "edit") return;

    if (!canUseCalendar) {
      setFormError("일정을 삭제하려면 로그인이 필요합니다.");
      return;
    }

    const shouldDelete = window.confirm(
      `"${sheetMode.event.title}" 일정을 삭제할까요?`
    );
    if (!shouldDelete) return;

    setIsSubmitting(true);
    setFormError(null);

    try {
      await calendarClient.deleteEvent(workspaceId, sheetMode.event.id);
      setSheetMode(null);
      await calendarEvents.reload();
    } catch (deleteError) {
      setFormError(errorMessageFromUnknown(deleteError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card id="month">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" />
              {calendarNavigation.title}
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
                onClick={() => goToMonth(shiftMonth(monthDate, -1))}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={goToToday}
              >
                오늘
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="다음 달"
                onClick={() => goToMonth(shiftMonth(monthDate, 1))}
              >
                <ChevronRight />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-2xl font-semibold leading-tight">
                  {monthLabel}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {calendarEvents.events.length}개 일정
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canUseCalendar || isLoading}
                  onClick={() => void calendarEvents.reload()}
                >
                  {isLoading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  새로고침
                </Button>
                <Button
                  id="new"
                  type="button"
                  size="sm"
                  disabled={!canUseCalendar}
                  onClick={() => openCreateSheet(selectedDate)}
                >
                  <CalendarPlus />
                  일정 추가
                </Button>
              </div>
            </div>

            {needsSignIn ? (
              <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                일정을 보려면 로그인이 필요합니다.
              </p>
            ) : null}
            {calendarEvents.error ? (
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                일정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <div className="min-w-[760px] rounded-lg border">
                <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
                  {calendarWeekdayLabels.map((weekday) => (
                    <div key={weekday} className="px-2 py-2 text-center">
                      {weekday}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {gridDates.map((date) => {
                    const dateEvents = eventsByDate.get(date) ?? [];
                    const visibleEvents = dateEvents.slice(0, 3);
                    const hiddenEventCount =
                      dateEvents.length - visibleEvents.length;
                    const isSelected = date === selectedDate;
                    const isToday = date === today;
                    const isCurrentMonth = isDateInMonth(date, monthDate);

                    return (
                      <button
                        key={date}
                        type="button"
                        className={classNames(
                          "min-h-32 border-b border-r p-2 text-left align-top transition last:border-r-0 hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          !isCurrentMonth &&
                            "bg-muted/20 text-muted-foreground",
                          isSelected &&
                            "bg-primary/10 ring-2 ring-inset ring-primary",
                          isToday && !isSelected && "bg-secondary/70"
                        )}
                        onClick={() => setSelectedDate(date)}
                      >
                        <span
                          className={classNames(
                            "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium",
                            isToday && "bg-primary text-primary-foreground"
                          )}
                        >
                          {formatCellDay(date)}
                        </span>
                        <span className="mt-2 flex flex-col gap-1">
                          {visibleEvents.map((event) => (
                            <span
                              key={`${date}-${event.id}`}
                              className="flex min-w-0 items-center gap-1 rounded-md bg-background/85 px-1.5 py-1 text-xs text-foreground shadow-sm ring-1 ring-border"
                            >
                              <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: event.color }}
                              />
                              <span className="truncate">{event.title}</span>
                            </span>
                          ))}
                          {hiddenEventCount > 0 ? (
                            <span className="rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                              +{hiddenEventCount}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card id="today" className="xl:sticky xl:top-4 xl:self-start">
          <CardHeader>
            <CardTitle>{selectedDateLabel}</CardTitle>
            <CardDescription>{formatDateLabel(selectedDate)}</CardDescription>
            <CardAction>
              <Button
                type="button"
                size="sm"
                disabled={!canUseCalendar}
                onClick={() => openCreateSheet(selectedDate)}
              >
                <CalendarPlus />
                추가
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {isLoading && selectedDateEvents.length === 0 ? (
              <div className="grid gap-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : selectedDateEvents.length > 0 ? (
              <ul className="grid gap-2" aria-label="선택 날짜 일정 목록">
                {selectedDateEvents.map((event) => (
                  <li
                    key={event.id}
                    className="grid gap-3 rounded-lg border bg-background p-3 sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: event.color }}
                        />
                        <p className="truncate text-sm font-medium">
                          {event.title}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {getEventTimeLabel(event)} · {getEventDateLabel(event)}
                      </p>
                      {event.description ? (
                        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                          {event.description}
                        </p>
                      ) : null}
                      {event.createdByUser ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          등록자: {event.createdByUser.name ?? event.createdBy}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditSheet(event)}
                    >
                      <Pencil />
                      수정
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                {canUseCalendar
                  ? "선택한 날짜에 등록된 일정이 없습니다."
                  : "로그인 후 일정을 확인할 수 있습니다."}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <CalendarEventSheet
        formError={formError}
        formState={formState}
        isSubmitting={isSubmitting}
        mode={sheetMode}
        onClose={closeSheet}
        onDelete={handleDeleteEvent}
        onFormChange={updateFormField}
        onSubmit={handleFormSubmit}
      />
    </div>
  );
}
