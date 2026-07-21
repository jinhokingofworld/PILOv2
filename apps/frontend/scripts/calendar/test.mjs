import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const calendarTypes = await readFile(
  new URL("../../src/features/calendar/types.ts", import.meta.url),
  "utf8"
);
const calendarApiClient = await readFile(
  new URL("../../src/features/calendar/api/client.ts", import.meta.url),
  "utf8"
);
const calendarHook = await readFile(
  new URL(
    "../../src/features/calendar/hooks/use-calendar-month-events.ts",
    import.meta.url
  ),
  "utf8"
);
const calendarDateRange = await readFile(
  new URL(
    "../../src/features/calendar/calendar-date-range.ts",
    import.meta.url
  ),
  "utf8"
);
const calendarPanel = await readFile(
  new URL(
    "../../src/features/calendar/components/calendar-panel.tsx",
    import.meta.url
  ),
  "utf8"
);

assert.match(calendarTypes, /export type CalendarEvent/);
assert.match(calendarTypes, /googleSync/);
assert.match(calendarTypes, /export type CreateCalendarEventInput/);
assert.match(calendarTypes, /export type UpdateCalendarEventInput/);
assert.match(calendarApiClient, /createCalendarApiClient/);
assert.match(calendarApiClient, /listEvents/);
assert.match(calendarApiClient, /getEvent/);
assert.match(calendarApiClient, /createEvent/);
assert.match(calendarApiClient, /updateEvent/);
assert.match(calendarApiClient, /deleteEvent/);
assert.doesNotMatch(calendarApiClient, /getGoogleConnection/);
assert.doesNotMatch(calendarApiClient, /startGoogleConnection/);
assert.doesNotMatch(calendarApiClient, /listGoogleCalendars/);
assert.doesNotMatch(calendarApiClient, /selectGoogleCalendar/);
assert.doesNotMatch(calendarApiClient, /enableGoogleSync/);
assert.match(calendarApiClient, /retryGoogleSync/);
assert.match(calendarApiClient, /Authorization/);
assert.match(calendarApiClient, /credentials: "same-origin"/);
assert.match(calendarApiClient, /success === true/);
assert.doesNotMatch(calendarApiClient, /credentials: "include"/);
assert.match(calendarHook, /useCalendarMonthEvents/);
assert.match(calendarHook, /getCalendarMonthRange/);
assert.match(calendarHook, /getCalendarMonthGridRange/);
assert.match(calendarDateRange, /calendarGridWeekCount = 6/);
assert.match(calendarDateRange, /calendarWeekdayCount = 7/);
assert.match(calendarDateRange, /-monthStartDate\.getDay\(\)/);
assert.match(calendarPanel, /useCalendarMonthEvents/);
assert.doesNotMatch(calendarPanel, /@base-ui\/react\/dialog/);
assert.doesNotMatch(calendarPanel, /DialogPrimitive\./);
assert.doesNotMatch(calendarPanel, /bg-black\/35/);
assert.match(calendarPanel, /@\/components\/ui\/dialog/);
assert.match(calendarPanel, /DialogContent/);
assert.match(calendarPanel, /DialogHeader/);
assert.match(calendarPanel, /DialogTitle/);
assert.match(calendarPanel, /DialogDescription/);
assert.match(calendarPanel, /@\/components\/ui\/card/);
assert.match(calendarPanel, /<Card/);
assert.match(calendarPanel, /@\/components\/ui\/textarea/);
assert.match(calendarPanel, /<Textarea/);
assert.match(calendarPanel, /@\/components\/ui\/switch/);
assert.match(calendarPanel, /<Switch/);
assert.doesNotMatch(calendarPanel, /type="checkbox"/);
assert.match(calendarPanel, /max-w-2xl/);
assert.match(calendarPanel, /useAuthSession/);
assert.match(calendarPanel, /activeWorkspaceId/);
assert.match(calendarPanel, /authSession\?\.accessToken/);
assert.match(calendarPanel, /일정을 보려면 로그인이 필요합니다/);
assert.match(calendarPanel, /createCalendarApiClient/);
assert.match(calendarPanel, /getCalendarGridDates/);
assert.match(calendarPanel, /getEventsForCalendarDate/);
assert.match(calendarPanel, /getCalendarWeekEventBars/);
assert.match(calendarPanel, /getCalendarDateBarLayout/);
assert.match(calendarPanel, /CalendarMonthPicker/);
assert.match(calendarPanel, /<h1[^>]*>\s*캘린더\s*<\/h1>/);
assert.match(
  calendarPanel,
  /일정 수정[\s\S]*?className="border-t p-4 space-y-3"[\s\S]*?onRequestDelete/
);
assert.match(
  calendarPanel,
  /onDoubleClick=\{\(\) => openCreateDialog\(date\)\}/
);
assert.match(
  calendarPanel,
  /aria-label=\{`\$\{formatDateLabel\(date\)\} 일정 추가`\}/
);
assert.doesNotMatch(
  calendarPanel,
  /calendarEvents\.events\.length\}개 일정/
);
assert.doesNotMatch(calendarPanel, /dateBarLayout\.connectsToPrevious/);
assert.doesNotMatch(calendarPanel, /dateBarLayout\.connectsToNext/);
assert.match(calendarPanel, /border-l-0/);
assert.match(calendarPanel, /border-r-0/);
assert.match(calendarPanel, /dateBarLayout\.laneCount/);
assert.match(calendarPanel, /const CALENDAR_EVENT_HEIGHT = 28/);
assert.match(calendarPanel, /const CALENDAR_EVENT_GAP = 4/);
assert.match(
  calendarPanel,
  /const CALENDAR_EVENT_LANE_HEIGHT =\s*CALENDAR_EVENT_HEIGHT \+ CALENDAR_EVENT_GAP/
);
assert.match(
  calendarPanel,
  /minHeight: `\$\{128 \+ dateBarLayout\.laneCount \* CALENDAR_EVENT_LANE_HEIGHT\}px`/
);
assert.match(
  calendarPanel,
  /marginTop: `\$\{12 \+ dateBarLayout\.laneCount \* CALENDAR_EVENT_LANE_HEIGHT\}px`/
);
assert.match(calendarPanel, /CalendarEventBar/);
assert.match(calendarPanel, /pointer-events-none absolute inset-x-0\.75 top-11/);
assert.match(calendarPanel, /grid-cols-7 auto-rows-7 gap-y-1/);
assert.match(calendarPanel, /flex h-7 min-w-0 items-center border-y/);
assert.match(calendarPanel, /flex h-7 min-w-0 items-center rounded-md border/);
assert.match(calendarPanel, /"ml-2 rounded-l-md border-l"/);
assert.match(calendarPanel, /"mr-2 rounded-r-md border-r"/);
assert.match(calendarPanel, /relative mx-0\.75 rounded-xl border/);
assert.match(
  calendarPanel,
  /pointer-events-none absolute inset-0\.5 z-40 rounded-\[10px\] ring-2 ring-inset ring-ring/
);
assert.match(calendarPanel, /CalendarEventDialog/);
assert.match(
  calendarPanel,
  /function CalendarEventDialog\([\s\S]*?if \(!mode\) \{\s*return null;/
);
assert.match(calendarPanel, /CalendarEventCreateDialog/);
assert.doesNotMatch(calendarPanel, /Google Calendar에 추가/);
assert.doesNotMatch(calendarPanel, /GoogleCalendarPickerDialog/);
assert.doesNotMatch(calendarPanel, /googleCalendarConnected/);
assert.doesNotMatch(calendarPanel, /googleCalendarError/);
assert.doesNotMatch(calendarPanel, /googleSyncEnabled/);
assert.match(calendarPanel, /동기화 실패/);
assert.match(calendarPanel, /retryGoogleSync/);
assert.match(calendarPanel, /CalendarEventDetailDialog/);
assert.match(calendarPanel, /CalendarEventsDialog/);
assert.match(calendarPanel, /CalendarEventsDialogState/);
assert.match(calendarPanel, /detailEvent/);
assert.match(calendarPanel, /calendarAction/);
assert.match(calendarPanel, /readCalendarDraftFormState/);
assert.match(calendarPanel, /clearCalendarDraftSearchParams/);
assert.match(calendarPanel, /setIsCreateDialogOpen\(true\)/);
assert.doesNotMatch(calendarPanel, /setSheetMode\(\{ type: "create" \}\)/);
assert.doesNotMatch(calendarPanel, /type: "detail"/);
assert.match(calendarPanel, /type: "delete"/);
assert.match(calendarPanel, /일정 상세/);
assert.match(calendarPanel, /openDetailDialog/);
assert.match(calendarPanel, /setDetailEvent/);
assert.match(calendarPanel, /openEventsDialog/);
assert.match(calendarPanel, /onRequestDelete/);
assert.match(calendarPanel, /formatDateTimeLabel/);
assert.match(calendarPanel, /calendarGridCellCount = 42/);
assert.match(calendarPanel, /calendarWeekdayLabels/);
assert.match(calendarPanel, /type="date"/);
assert.match(calendarPanel, /type="time"/);
assert.match(calendarPanel, /createEvent/);
assert.match(calendarPanel, /updateEvent/);
assert.match(calendarPanel, /deleteEvent/);
assert.match(calendarPanel, /등록자/);
assert.match(calendarPanel, /일정 추가/);
assert.doesNotMatch(calendarPanel, /role="dialog"/);
assert.doesNotMatch(calendarPanel, /aria-modal="true"/);
assert.match(calendarPanel, /CalendarEventChip/);
assert.match(calendarPanel, /getAllDayEventChipStyle/);
assert.match(calendarPanel, /createdAtCompare/);
assert.doesNotMatch(calendarPanel, /window\.confirm/);
assert.doesNotMatch(calendarPanel, /colorWithAlpha/);
assert.doesNotMatch(calendarPanel, /id="today"/);
assert.doesNotMatch(calendarPanel, /selectedDateEvents/);
assert.doesNotMatch(calendarPanel, /pilo_access_token/);
assert.doesNotMatch(calendarPanel, /pilo_access_token 대기 중/);
assert.doesNotMatch(calendarPanel, /API client 준비 완료/);
assert.doesNotMatch(calendarPanel, /NEXT_PUBLIC_PILO_WORKSPACE_ID/);
assert.doesNotMatch(calendarPanel, /pilo-local-workspace/);
assert.doesNotMatch(calendarPanel, /localStorage/);
assert.doesNotMatch(calendarPanel, /Workspace ID/);
assert.doesNotMatch(calendarPanel, /워크스페이스 ID/);

await import("../../src/features/calendar/calendar-event-bars.test.mjs");
await import("../../src/features/calendar/calendar-month-selection.test.mjs");
