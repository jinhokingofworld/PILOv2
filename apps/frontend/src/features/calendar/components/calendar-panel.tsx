"use client";

import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthSession } from "@/features/auth";
import { createCalendarApiClient } from "@/features/calendar/api/client";
import {
  getCalendarDateBarLayout,
  getCalendarWeekEventBars,
  type CalendarEventBarSegment
} from "@/features/calendar/calendar-event-bars";
import { CalendarWorkspaceLocationAdapter } from "@/features/calendar/calendar-workspace-location-adapter";
import {
  formatCalendarDate,
  useCalendarMonthEvents
} from "@/features/calendar/hooks/use-calendar-month-events";
import type {
  CalendarEvent,
  CreateCalendarEventInput
} from "@/features/calendar/types";
import { PageCursorSurface } from "@/shared/page-cursor/PageCursorSurface";
import { pageCursorTargetAttributes } from "@/shared/page-cursor/page-cursor-target";

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
      type: "edit";
      event: CalendarEvent;
    }
  | {
      type: "delete";
      event: CalendarEvent;
      returnTo: "detail" | "edit";
    };

type CalendarEventsDialogState = {
  date: string;
  events: CalendarEvent[];
} | null;

const DEFAULT_EVENT_COLOR = "#3B82F6";
const CALENDAR_EVENT_LANE_HEIGHT = 28;
const CALENDAR_DRAFT_ACTION_SEARCH_PARAM = "calendarAction";
const CALENDAR_SELECTED_DATE_SEARCH_PARAM = "date";
const CALENDAR_DRAFT_SEARCH_PARAMS = [
  CALENDAR_DRAFT_ACTION_SEARCH_PARAM,
  "color",
  "date",
  "description",
  "endDate",
  "endTime",
  "isAllDay",
  "startTime",
  "title"
] as const;
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

function startOfCalendarMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addCalendarDays(date: Date, dayOffset: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset
  );
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

function isCalendarDateInputValue(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isValidCalendarDateInput(value: string | null): value is string {
  if (!value || !isCalendarDateInputValue(value)) {
    return false;
  }

  return formatCalendarDate(parseCalendarDateInput(value)) === value;
}

function isCalendarTimeInputValue(value: string | null) {
  return Boolean(value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function isCalendarColorValue(value: string | null) {
  return Boolean(value && /^#[\dA-Fa-f]{6}$/.test(value));
}

function parseCalendarDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
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

function formatDateTimeLabel(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return [
    `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`,
    `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}`
  ].join(" ");
}

function getEventCreatorLabel(event: CalendarEvent) {
  return event.createdByUser?.name ?? event.createdBy;
}

function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent) {
  if (a.isAllDay !== b.isAllDay) {
    return a.isAllDay ? -1 : 1;
  }

  if (!a.isAllDay && !b.isAllDay) {
    const timeCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
    if (timeCompare !== 0) {
      return timeCompare;
    }
  }

  const createdAtCompare = a.createdAt.localeCompare(b.createdAt);
  if (createdAtCompare !== 0) {
    return createdAtCompare;
  }

  return a.title.localeCompare(b.title);
}

function getEventsForCalendarDate(events: CalendarEvent[], date: string) {
  return events
    .filter((event) => event.startDate <= date && event.endDate >= date)
    .sort(compareCalendarEvents);
}

function isMultiDayCalendarEvent(event: CalendarEvent) {
  return event.startDate < event.endDate;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function hexToRgb(hexColor: string) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hexColor);
  if (!match) {
    return null;
  }

  return {
    red: Number.parseInt(match[1], 16),
    green: Number.parseInt(match[2], 16),
    blue: Number.parseInt(match[3], 16)
  };
}

function readableTextColor(backgroundColor: string) {
  const rgb = hexToRgb(backgroundColor);
  if (!rgb) {
    return "#FFFFFF";
  }

  const luminance =
    (0.299 * rgb.red + 0.587 * rgb.green + 0.114 * rgb.blue) / 255;

  return luminance > 0.68 ? "#111827" : "#FFFFFF";
}

function getAllDayEventChipStyle(event: CalendarEvent) {
  return {
    backgroundColor: event.color,
    borderColor: event.color,
    color: readableTextColor(event.color)
  };
}

function CalendarEventChip({
  className,
  event
}: {
  className?: string;
  event: CalendarEvent;
}) {
  if (event.isAllDay) {
    return (
      <span
        className={classNames(
          "flex min-w-0 items-center rounded-md border px-1.5 py-1 text-xs font-medium shadow-sm",
          className
        )}
        style={getAllDayEventChipStyle(event)}
      >
        <span className="truncate">{event.title}</span>
      </span>
    );
  }

  return (
    <span
      className={classNames(
        "flex min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-foreground",
        className
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: event.color }}
      />
      <span className="truncate">{event.title}</span>
    </span>
  );
}

function CalendarEventBar({
  onOpen,
  segment
}: {
  onOpen: (event: CalendarEvent) => void;
  segment: CalendarEventBarSegment;
}) {
  const { event } = segment;

  return (
    <button
      {...pageCursorTargetAttributes({
        id: event.id,
        label: event.title,
        type: "calendar_event"
      })}
      type="button"
      className={classNames(
        "pointer-events-auto flex h-7 min-w-0 items-center border-y px-2 text-left text-xs font-medium shadow-sm transition hover:brightness-95 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        segment.continuesFromPreviousWeek
          ? "rounded-l-none border-l-0"
          : "rounded-l-md border-l",
        segment.continuesToNextWeek
          ? "rounded-r-none border-r-0"
          : "rounded-r-md border-r"
      )}
      style={{
        ...getAllDayEventChipStyle(event),
        gridColumn: `${segment.startColumn} / ${segment.endColumn + 1}`,
        gridRow: segment.lane + 1
      }}
      onClick={() => onOpen(event)}
    >
      <span className="truncate">{event.title}</span>
    </button>
  );
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

function readCalendarDraftFormState(
  search: string,
  fallbackDate: string
): CalendarFormState | null {
  const params = new URLSearchParams(search);

  if (params.get(CALENDAR_DRAFT_ACTION_SEARCH_PARAM) !== "create") {
    return null;
  }

  const startDate = isCalendarDateInputValue(params.get("date"))
    ? params.get("date")!
    : fallbackDate;
  const endDate = isCalendarDateInputValue(params.get("endDate"))
    ? params.get("endDate")!
    : startDate;
  const isAllDay = params.get("isAllDay") === "true";
  const defaultFormState = createDefaultFormState(startDate);

  return {
    ...defaultFormState,
    color: isCalendarColorValue(params.get("color"))
      ? params.get("color")!
      : defaultFormState.color,
    description: params.get("description")?.slice(0, 1000) ?? "",
    endDate: endDate < startDate ? startDate : endDate,
    endTime: isCalendarTimeInputValue(params.get("endTime"))
      ? params.get("endTime")!
      : "",
    isAllDay,
    startTime: isCalendarTimeInputValue(params.get("startTime"))
      ? params.get("startTime")!
      : defaultFormState.startTime,
    title: params.get("title")?.slice(0, 255) ?? ""
  };
}

function clearCalendarDraftSearchParams() {
  const url = new URL(window.location.href);

  CALENDAR_DRAFT_SEARCH_PARAMS.forEach((param) =>
    url.searchParams.delete(param)
  );

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(null, "", nextUrl);
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

function CalendarEventFormFields({
  formError,
  formState,
  onFormChange
}: {
  formError: string | null;
  formState: CalendarFormState;
  onFormChange: <Field extends keyof CalendarFormState>(
    field: Field,
    value: CalendarFormState[Field]
  ) => void;
}) {
  return (
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
          placeholder="메모를 남길 수 있습니다"
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
  );
}

function CalendarEventDialog({
  formError,
  formState,
  isSubmitting,
  mode,
  onCancelDelete,
  onClose,
  onConfirmDelete,
  onFormChange,
  onRequestDelete,
  onSubmit
}: {
  formError: string | null;
  formState: CalendarFormState;
  isSubmitting: boolean;
  mode: CalendarSheetMode | null;
  onCancelDelete: () => void;
  onClose: () => void;
  onConfirmDelete: () => void;
  onFormChange: <Field extends keyof CalendarFormState>(
    field: Field,
    value: CalendarFormState[Field]
  ) => void;
  onRequestDelete: (
    event: CalendarEvent,
    returnTo: Extract<CalendarSheetMode, { type: "delete" }>["returnTo"]
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!mode) {
    return null;
  }

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/35 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(660px,calc(100vh-2rem))] flex-col overflow-hidden rounded-lg border bg-background shadow-xl outline-none transition duration-150 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-[calc(100vw-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:data-ending-style:translate-y-0 sm:data-ending-style:scale-95 sm:data-starting-style:translate-y-0 sm:data-starting-style:scale-95">
          {mode.type === "delete" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b p-4 pr-14">
                <DialogPrimitive.Title className="font-heading text-lg font-semibold">
                  일정 삭제
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                  삭제한 일정은 되돌릴 수 없습니다.
                </DialogPrimitive.Description>
              </div>

              <DialogPrimitive.Close
                disabled={isSubmitting}
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-3 right-3"
                    aria-label="일정 삭제 닫기"
                  />
                }
              >
                <X className="size-4" />
              </DialogPrimitive.Close>

              <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-2">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-sm text-muted-foreground">
                    다음 일정을 삭제할까요?
                  </p>
                  <p className="mt-2 break-words font-medium">
                    {mode.event.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {getEventDateLabel(mode.event)} ·{" "}
                    {getEventTimeLabel(mode.event)}
                  </p>
                </div>

                {formError ? (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {formError}
                  </p>
                ) : null}
              </div>

              <div className="border-t p-4">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={isSubmitting}
                    onClick={onCancelDelete}
                  >
                    취소
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="flex-1"
                    disabled={isSubmitting}
                    onClick={onConfirmDelete}
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                    삭제
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
              <div className="border-b p-4 pr-14">
                <DialogPrimitive.Title className="font-heading text-lg font-semibold">
                  일정 수정
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                  {formatDateLabel(formState.startDate)}
                </DialogPrimitive.Description>
              </div>

              <DialogPrimitive.Close
                disabled={isSubmitting}
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-3 right-3"
                    aria-label="일정 수정 닫기"
                  />
                }
              >
                <X className="size-4" />
              </DialogPrimitive.Close>

              <CalendarEventFormFields
                formError={formError}
                formState={formState}
                onFormChange={onFormChange}
              />

              <div className="border-t p-4">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isSubmitting}
                  onClick={() => onRequestDelete(mode.event, "edit")}
                >
                  <Trash2 />
                  삭제
                </Button>
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
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                    저장
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CalendarEventCreateDialog({
  formError,
  formState,
  isOpen,
  isSubmitting,
  onClose,
  onFormChange,
  googleSyncEnabled,
  onGoogleSyncChange,
  onSubmit
}: {
  formError: string | null;
  formState: CalendarFormState;
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onFormChange: <Field extends keyof CalendarFormState>(
    field: Field,
    value: CalendarFormState[Field]
  ) => void;
  googleSyncEnabled: boolean;
  onGoogleSyncChange: (enabled: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/35 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(660px,calc(100vh-2rem))] flex-col overflow-hidden rounded-lg border bg-background shadow-xl outline-none transition duration-150 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-[calc(100vw-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:data-ending-style:translate-y-0 sm:data-ending-style:scale-95 sm:data-starting-style:translate-y-0 sm:data-starting-style:scale-95">
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
            <div className="border-b p-4 pr-14">
              <DialogPrimitive.Title className="font-heading text-lg font-semibold">
                새 일정
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {formatDateLabel(formState.startDate)}
              </DialogPrimitive.Description>
            </div>

            <DialogPrimitive.Close
              disabled={isSubmitting}
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-3 right-3"
                  aria-label="새 일정 닫기"
                />
              }
            >
              <X className="size-4" />
            </DialogPrimitive.Close>

            <CalendarEventFormFields
              formError={formError}
              formState={formState}
              onFormChange={onFormChange}
            />
            <label className="mx-4 mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium">
              <span>Google Calendar에 추가</span>
              <input
                type="checkbox"
                checked={googleSyncEnabled}
                className="size-4"
                onChange={(event) => onGoogleSyncChange(event.currentTarget.checked)}
              />
            </label>

            <div className="border-t p-4">
              <div className="flex gap-2">
                <DialogPrimitive.Close
                  disabled={isSubmitting}
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                    />
                  }
                >
                  취소
                </DialogPrimitive.Close>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                  등록
                </Button>
              </div>
            </div>
          </form>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CalendarEventDetailDialog({
  event,
  isSubmitting,
  onClose,
  onOpenEdit,
  onRetryGoogleSync,
  onRequestDelete
}: {
  event: CalendarEvent | null;
  isSubmitting: boolean;
  onClose: () => void;
  onOpenEdit: (event: CalendarEvent) => void;
  onRetryGoogleSync: (event: CalendarEvent) => void;
  onRequestDelete: (
    event: CalendarEvent,
    returnTo: Extract<CalendarSheetMode, { type: "delete" }>["returnTo"]
  ) => void;
}) {
  if (!event) {
    return null;
  }

  return (
    <DialogPrimitive.Root
      open={Boolean(event)}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/35 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(660px,calc(100vh-2rem))] flex-col rounded-lg border bg-background shadow-xl outline-none transition duration-150 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-[calc(100vw-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:data-ending-style:translate-y-0 sm:data-ending-style:scale-95 sm:data-starting-style:translate-y-0 sm:data-starting-style:scale-95">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">
              일정 상세
            </p>
            <DialogPrimitive.Title
              className="mt-1 break-words font-heading text-xl font-semibold"
            >
              {event.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              {getEventDateLabel(event)}
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close
            disabled={isSubmitting}
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="닫기"
              />
            }
          >
            <X />
          </DialogPrimitive.Close>
        </div>

        <div
          className="h-1 shrink-0"
          style={{ backgroundColor: event.color }}
        />

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-start gap-3">
            <span
              className="mt-1 size-3 shrink-0 rounded-full"
              style={{ backgroundColor: event.color }}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{getEventTimeLabel(event)}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {event.description || "등록된 설명이 없습니다."}
              </p>
            </div>
          </div>

          {event.googleSync ? (
            <div className="mt-4 rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium">
                Google Calendar: {event.googleSync.status === "synced" ? "동기화됨" : event.googleSync.status === "pending" ? "동기화 대기 중" : "동기화 실패"}
              </p>
              {event.googleSync.status === "failed" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{event.googleSync.lastError || "Google Calendar 동기화에 실패했습니다."}</span>
                  <Button type="button" size="sm" variant="outline" disabled={isSubmitting} onClick={() => onRetryGoogleSync(event)}>다시 시도</Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">날짜</dt>
              <dd>{getEventDateLabel(event)}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">시간</dt>
              <dd>{getEventTimeLabel(event)}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">등록자</dt>
              <dd>{getEventCreatorLabel(event)}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">색상</dt>
              <dd className="flex items-center gap-2">
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: event.color }}
                />
                <span>{event.color}</span>
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">생성일</dt>
              <dd>{formatDateTimeLabel(event.createdAt)}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">수정일</dt>
              <dd>{formatDateTimeLabel(event.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            disabled={isSubmitting}
            onClick={() => onRequestDelete(event, "detail")}
          >
            <Trash2 />
            삭제
          </Button>
          <div className="flex gap-2">
            <DialogPrimitive.Close
              disabled={isSubmitting}
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                />
              }
            >
              닫기
            </DialogPrimitive.Close>
            <Button
              type="button"
              className="flex-1 sm:flex-none"
              disabled={isSubmitting}
              onClick={() => onOpenEdit(event)}
            >
              <Pencil />
              수정
            </Button>
          </div>
        </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CalendarEventsDialog({
  dialog,
  onClose,
  onOpenEvent
}: {
  dialog: CalendarEventsDialogState;
  onClose: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
}) {
  if (!dialog) {
    return null;
  }

  return (
    <DialogPrimitive.Root
      open={Boolean(dialog)}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/35 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(560px,calc(100vh-2rem))] flex-col rounded-lg border bg-background shadow-xl outline-none transition duration-150 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-[calc(100vw-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:data-ending-style:translate-y-0 sm:data-ending-style:scale-95 sm:data-starting-style:translate-y-0 sm:data-starting-style:scale-95">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="font-heading text-lg font-semibold">
              일정 목록
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              {formatDateLabel(dialog.date)} · {dialog.events.length}개 일정
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="닫기"
              />
            }
          >
            <X />
          </DialogPrimitive.Close>
        </div>

        <ul className="grid gap-2 overflow-y-auto p-4">
          {dialog.events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                className="grid w-full gap-2 rounded-lg border bg-background p-3 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpenEvent(event)}
              >
                <CalendarEventChip className="text-sm" event={event} />
                <span className="text-xs text-muted-foreground">
                  {getEventTimeLabel(event)} · {getEventDateLabel(event)}
                </span>
                {event.description ? (
                  <span className="line-clamp-2 text-sm text-muted-foreground">
                    {event.description}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function GoogleCalendarPickerDialog({
  dialog,
  isSubmitting,
  onClose,
  onSelect
}: {
  dialog: { eventId: number | null; calendars: Array<{ id: string; summary: string; primary: boolean }> } | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSelect: (calendarId: string) => void;
}) {
  if (!dialog) return null;
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/35" />
        <DialogPrimitive.Popup className="fixed inset-x-3 bottom-3 z-50 rounded-lg border bg-background shadow-xl outline-none sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-[calc(100vw-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div className="border-b p-4">
            <DialogPrimitive.Title className="font-heading text-lg font-semibold">Google Calendar 선택</DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">일정을 추가할 Google Calendar를 선택하세요.</DialogPrimitive.Description>
          </div>
          <div className="grid gap-2 p-4">
            {dialog.calendars.map((calendar) => (
              <Button key={calendar.id} type="button" variant="outline" className="justify-between" disabled={isSubmitting} onClick={() => onSelect(calendar.id)}>
                <span className="truncate">{calendar.summary}</span>
                {calendar.primary ? <span className="text-xs text-muted-foreground">기본</span> : null}
              </Button>
            ))}
            {dialog.calendars.length === 0 ? <p className="text-sm text-muted-foreground">선택할 Google Calendar가 없습니다.</p> : null}
          </div>
          <div className="border-t p-4"><Button type="button" variant="outline" className="w-full" disabled={isSubmitting} onClick={onClose}>나중에</Button></div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function CalendarPanel() {
  const authSession = useAuthSession();
  const calendarGridRef = useRef<HTMLDivElement | null>(null);
  const [monthDate, setMonthDate] = useState(() =>
    startOfCalendarMonth(new Date())
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    formatCalendarDate(new Date())
  );
  const [sheetMode, setSheetMode] = useState<CalendarSheetMode | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [eventsDialog, setEventsDialog] =
    useState<CalendarEventsDialogState>(null);
  const [formState, setFormState] = useState(() =>
    createDefaultFormState(formatCalendarDate(new Date()))
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleSyncEnabled, setGoogleSyncEnabled] = useState(false);
  const [googleCalendarPicker, setGoogleCalendarPicker] = useState<{
    eventId: number | null;
    calendars: Array<{ id: string; summary: string; primary: boolean }>;
  } | null>(null);
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const monthLabel = formatMonthLabel(monthDate);
  const today = useMemo(() => formatCalendarDate(new Date()), []);
  const normalizedAccessToken = authSession?.accessToken.trim() ?? "";
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
  const calendarWeeks = useMemo(
    () => getCalendarWeekEventBars(calendarEvents.events, gridDates),
    [calendarEvents.events, gridDates]
  );
  const needsSignIn = !normalizedAccessToken;
  const isLoading = calendarEvents.status === "loading";
  const canUseCalendar = Boolean(workspaceId.trim() && normalizedAccessToken);
  const handleWorkspaceLocationDate = useCallback((date: string | null) => {
    if (!date) {
      return;
    }
    setMonthDate(startOfCalendarMonth(parseCalendarDateInput(date)));
    setSelectedDate(date);
  }, []);

  useEffect(() => {
    const draftFormState = readCalendarDraftFormState(
      window.location.search,
      today
    );

    if (!draftFormState) {
      return;
    }

    const draftMonthDate = startOfCalendarMonth(
      parseCalendarDateInput(draftFormState.startDate)
    );

    setMonthDate(draftMonthDate);
    setSelectedDate(draftFormState.startDate);
    setDetailEvent(null);
    setEventsDialog(null);
    setFormState(draftFormState);
    setFormError(null);
    setSheetMode(null);
    setIsCreateDialogOpen(true);
    clearCalendarDraftSearchParams();
  }, [today]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.has(CALENDAR_DRAFT_ACTION_SEARCH_PARAM)) {
      return;
    }

    const selectedDateParam = searchParams.get(CALENDAR_SELECTED_DATE_SEARCH_PARAM);
    if (!isValidCalendarDateInput(selectedDateParam)) {
      return;
    }

    setMonthDate(startOfCalendarMonth(parseCalendarDateInput(selectedDateParam)));
    setSelectedDate(selectedDateParam);
    setDetailEvent(null);
    setEventsDialog(null);
    setFormError(null);
    setSheetMode(null);
    setIsCreateDialogOpen(false);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectionError = params.get("googleCalendarError");
    if (connectionError) {
      setSyncNotice("Google Calendar 연결에 실패했습니다. PILO 일정은 저장되어 있습니다.");
      params.delete("googleCalendarError");
    }
    if (params.get("googleCalendarConnected") !== "1") {
      if (connectionError) {
        window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
      }
      return;
    }
    const eventIdValue = Number(params.get("googleCalendarSyncEventId"));
    void calendarClient
      .listGoogleCalendars()
      .then((calendars) => setGoogleCalendarPicker({
        eventId: Number.isSafeInteger(eventIdValue) && eventIdValue > 0 ? eventIdValue : null,
        calendars
      }))
      .catch((error) => setSyncNotice(errorMessageFromUnknown(error)));
    params.delete("googleCalendarConnected");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }, [calendarClient]);

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

  const openCreateDialog = useCallback((date: string) => {
    setDetailEvent(null);
    setEventsDialog(null);
    setSheetMode(null);
    setFormState(createDefaultFormState(date));
    setFormError(null);
    setGoogleSyncEnabled(false);
    setIsCreateDialogOpen(true);
  }, []);

  const openDetailDialog = useCallback((event: CalendarEvent) => {
    setEventsDialog(null);
    setFormError(null);
    setSheetMode(null);
    setIsCreateDialogOpen(false);
    setDetailEvent(event);
  }, []);

  const openEditSheet = useCallback((event: CalendarEvent) => {
    setDetailEvent(null);
    setEventsDialog(null);
    setIsCreateDialogOpen(false);
    setFormState(createFormStateFromEvent(event));
    setFormError(null);
    setSheetMode({ type: "edit", event });
  }, []);

  const requestDeleteSheet = useCallback(
    (
      event: CalendarEvent,
      returnTo: Extract<CalendarSheetMode, { type: "delete" }>["returnTo"]
    ) => {
      setDetailEvent(null);
      setEventsDialog(null);
      setIsCreateDialogOpen(false);
      setFormError(null);
      setSheetMode({ type: "delete", event, returnTo });
    },
    []
  );

  const cancelDeleteSheet = useCallback(() => {
    if (sheetMode?.type !== "delete") return;

    setFormError(null);

    if (sheetMode.returnTo === "edit") {
      setFormState(createFormStateFromEvent(sheetMode.event));
      setSheetMode({ type: "edit", event: sheetMode.event });
      return;
    }

    setSheetMode(null);
    setDetailEvent(sheetMode.event);
  }, [sheetMode]);

  const closeSheet = useCallback(() => {
    if (!isSubmitting) {
      setSheetMode(null);
      setFormError(null);
    }
  }, [isSubmitting]);

  const closeCreateDialog = useCallback(() => {
    if (!isSubmitting) {
      setIsCreateDialogOpen(false);
      setFormError(null);
    }
  }, [isSubmitting]);

  const openEventsDialog = useCallback((date: string, events: CalendarEvent[]) => {
    setSelectedDate(date);
    setDetailEvent(null);
    setIsCreateDialogOpen(false);
    setSheetMode(null);
    setEventsDialog({ date, events });
  }, []);

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

  async function handleCreateEventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
      const created = await calendarClient.createEvent(workspaceId, result.input);

      setIsCreateDialogOpen(false);
      await calendarEvents.reload();
      if (googleSyncEnabled) {
        const connection = await calendarClient.getGoogleConnection();
        if (connection.connected && connection.targetCalendarId) {
          await calendarClient.enableGoogleSync(workspaceId, created.id);
          await calendarEvents.reload();
        } else if (connection.connected) {
          const calendars = await calendarClient.listGoogleCalendars();
          setGoogleCalendarPicker({ eventId: created.id, calendars });
        } else {
          const returnPath = `/calendar?googleCalendarSyncEventId=${created.id}`;
          const { authorizeUrl } = await calendarClient.startGoogleConnection(returnPath);
          window.location.assign(authorizeUrl);
        }
      }
    } catch (submitError) {
      setFormError(errorMessageFromUnknown(submitError));
      setSyncNotice(errorMessageFromUnknown(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEditEventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sheetMode?.type !== "edit") {
      return;
    }

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
      await calendarClient.updateEvent(
        workspaceId,
        sheetMode.event.id,
        result.input
      );

      setSheetMode(null);
      await calendarEvents.reload();
    } catch (submitError) {
      setFormError(errorMessageFromUnknown(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDeleteEvent() {
    if (sheetMode?.type !== "delete") return;

    if (!canUseCalendar) {
      setFormError("일정을 삭제하려면 로그인이 필요합니다.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await calendarClient.deleteEvent(workspaceId, sheetMode.event.id);
      setSheetMode(null);
      setDetailEvent(null);
      await calendarEvents.reload();
    } catch (deleteError) {
      setFormError(errorMessageFromUnknown(deleteError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PageCursorSurface
      className="relative flex min-h-[calc(100vh-6.5rem)] flex-col gap-4"
      enabled={canUseCalendar}
      page="calendar"
      workspaceId={workspaceId}
    >
      <CalendarWorkspaceLocationAdapter
        gridRef={calendarGridRef}
        onSelectDate={handleWorkspaceLocationDate}
        selectedDate={selectedDate}
      />
      <section id="month" className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
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
                aria-label="오늘이 포함된 달로 이동"
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
            </div>
            <span className="text-sm text-muted-foreground">
              {calendarEvents.events.length}개 일정
            </span>
          </div>

          <h1
            className="justify-self-start rounded-md px-2 py-1 text-left font-heading text-2xl font-semibold leading-tight outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:justify-self-center"
            onDoubleClick={goToToday}
          >
            {monthLabel}
          </h1>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
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
              {...pageCursorTargetAttributes({
                id: "new-event",
                label: "일정 추가",
                type: "calendar_action"
              })}
              id="new"
              type="button"
              size="sm"
              disabled={!canUseCalendar}
              onClick={() => openCreateDialog(selectedDate)}
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
        {syncNotice ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {syncNotice}
          </p>
        ) : null}

        <div ref={calendarGridRef} className="min-h-0 flex-1 overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7">
            {calendarWeekdayLabels.map((weekday) => (
              <div
                key={weekday}
                className="mx-0.75 px-2 py-1 text-center text-xs font-semibold text-muted-foreground"
              >
                {weekday}
              </div>
            ))}

            {calendarWeeks.map((week) => (
              <div
                key={week.dates[0]}
                className="relative col-span-7 grid grid-cols-7 pb-1.5"
              >
                {week.dates.map((date, dateIndex) => {
                  const dateEvents = eventsByDate.get(date) ?? [];
                  const dateBarLayout = getCalendarDateBarLayout(
                    week.segments,
                    dateIndex + 1
                  );
                  const singleDayEvents = dateEvents.filter(
                    (event) => !isMultiDayCalendarEvent(event)
                  );
                  const visibleEvents = singleDayEvents.slice(0, 3);
                  const hiddenEventCount =
                    singleDayEvents.length - visibleEvents.length;
                  const isSelected = date === selectedDate;
                  const isToday = date === today;
                  const isCurrentMonth = isDateInMonth(date, monthDate);

                  return (
                    <div
                      {...pageCursorTargetAttributes({
                        id: date,
                        label: formatDateLabel(date),
                        type: "calendar_date"
                      })}
                      key={date}
                      className={classNames(
                        "relative border bg-background p-2 text-left align-top transition",
                        dateBarLayout.connectsToPrevious
                          ? "ml-0 rounded-l-none border-l-0"
                          : "ml-0.75 rounded-l-lg",
                        dateBarLayout.connectsToNext
                          ? "mr-0 rounded-r-none border-r-0"
                          : "mr-0.75 rounded-r-lg",
                        !isCurrentMonth && "bg-muted/20 text-muted-foreground",
                        isSelected && "border-primary ring-2 ring-primary/80",
                        isToday && !isSelected && "border-primary/40 bg-primary/5"
                      )}
                      style={{
                        minHeight: `${128 + dateBarLayout.laneCount * CALENDAR_EVENT_LANE_HEIGHT}px`
                      }}
                    >
                      <button
                        type="button"
                        className="absolute inset-0 z-0 hover:bg-muted/40 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${formatDateLabel(date)} 선택`}
                        onClick={() => setSelectedDate(date)}
                      />
                      <div className="relative z-20 flex items-center justify-between">
                        <span
                          className={classNames(
                            "pointer-events-none inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                            isToday && "bg-primary text-primary-foreground"
                          )}
                        >
                          {formatCellDay(date)}
                        </span>
                      </div>
                      <div
                        className="relative z-20 flex flex-col gap-1"
                        style={{
                          marginTop: `${12 + dateBarLayout.laneCount * CALENDAR_EVENT_LANE_HEIGHT}px`
                        }}
                      >
                        {visibleEvents.map((event) => (
                          <button
                            {...pageCursorTargetAttributes({
                              id: event.id,
                              label: event.title,
                              type: "calendar_event"
                            })}
                            key={`${date}-${event.id}`}
                            type="button"
                            className={classNames(
                              "block min-w-0 rounded-md text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              event.isAllDay ? "hover:brightness-95" : "hover:bg-muted/40",
                              !isCurrentMonth && "opacity-65"
                            )}
                            onClick={() => {
                              setSelectedDate(date);
                              openDetailDialog(event);
                            }}
                          >
                            <CalendarEventChip event={event} />
                          </button>
                        ))}
                        {hiddenEventCount > 0 ? (
                          <button
                            type="button"
                            className="rounded-md px-1.5 py-0.5 text-left text-xs font-semibold text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => openEventsDialog(date, dateEvents)}
                          >
                            +{hiddenEventCount}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                <div className="pointer-events-none absolute inset-x-0.75 top-11 z-30 grid grid-cols-7 auto-rows-7 gap-x-1.5 gap-y-0">
                  {week.segments.map((segment) => (
                    <CalendarEventBar
                      key={`${segment.weekIndex}-${segment.event.id}`}
                      segment={segment}
                      onOpen={openDetailDialog}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CalendarEventsDialog
        dialog={eventsDialog}
        onClose={() => setEventsDialog(null)}
        onOpenEvent={openDetailDialog}
      />

      <CalendarEventCreateDialog
        formError={formError}
        formState={formState}
        isOpen={isCreateDialogOpen}
        isSubmitting={isSubmitting}
        onClose={closeCreateDialog}
        onFormChange={updateFormField}
        googleSyncEnabled={googleSyncEnabled}
        onGoogleSyncChange={setGoogleSyncEnabled}
        onSubmit={handleCreateEventSubmit}
      />

      <GoogleCalendarPickerDialog
        dialog={googleCalendarPicker}
        isSubmitting={isSubmitting}
        onClose={() => setGoogleCalendarPicker(null)}
        onSelect={async (calendarId) => {
          setIsSubmitting(true);
          setFormError(null);
          try {
            await calendarClient.selectGoogleCalendar(calendarId);
            if (googleCalendarPicker?.eventId) {
              await calendarClient.enableGoogleSync(workspaceId, googleCalendarPicker.eventId);
              await calendarEvents.reload();
            }
            setGoogleCalendarPicker(null);
          } catch (error) {
            setFormError(errorMessageFromUnknown(error));
            setSyncNotice(errorMessageFromUnknown(error));
          } finally {
            setIsSubmitting(false);
          }
        }}
      />

      <CalendarEventDetailDialog
        event={detailEvent}
        isSubmitting={isSubmitting}
        onClose={() => setDetailEvent(null)}
        onOpenEdit={openEditSheet}
        onRetryGoogleSync={(event) => {
          setIsSubmitting(true);
          setSyncNotice(null);
          void calendarClient.retryGoogleSync(workspaceId, event.id)
            .then(async () => {
              setDetailEvent((currentEvent) => currentEvent && currentEvent.id === event.id
                ? { ...currentEvent, googleSync: { status: "pending", lastError: null } }
                : currentEvent
              );
              await calendarEvents.reload();
            })
            .catch((error) => setSyncNotice(errorMessageFromUnknown(error)))
            .finally(() => setIsSubmitting(false));
        }}
        onRequestDelete={requestDeleteSheet}
      />

      <CalendarEventDialog
        formError={formError}
        formState={formState}
        isSubmitting={isSubmitting}
        mode={sheetMode}
        onCancelDelete={cancelDeleteSheet}
        onClose={closeSheet}
        onConfirmDelete={handleConfirmDeleteEvent}
        onFormChange={updateFormField}
        onRequestDelete={requestDeleteSheet}
        onSubmit={handleEditEventSubmit}
      />
    </PageCursorSurface>
  );
}
