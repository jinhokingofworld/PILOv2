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
const calendarPanel = await readFile(
  new URL(
    "../../src/features/calendar/components/calendar-panel.tsx",
    import.meta.url
  ),
  "utf8"
);

assert.match(calendarTypes, /export type CalendarEvent/);
assert.match(calendarTypes, /export type CreateCalendarEventInput/);
assert.match(calendarTypes, /export type UpdateCalendarEventInput/);
assert.match(calendarApiClient, /createCalendarApiClient/);
assert.match(calendarApiClient, /listEvents/);
assert.match(calendarApiClient, /getEvent/);
assert.match(calendarApiClient, /createEvent/);
assert.match(calendarApiClient, /updateEvent/);
assert.match(calendarApiClient, /deleteEvent/);
assert.match(calendarApiClient, /Authorization/);
assert.match(calendarApiClient, /credentials: "same-origin"/);
assert.match(calendarApiClient, /success === true/);
assert.doesNotMatch(calendarApiClient, /credentials: "include"/);
assert.match(calendarHook, /useCalendarMonthEvents/);
assert.match(calendarHook, /getCalendarMonthRange/);
assert.match(calendarHook, /getCalendarMonthGridRange/);
assert.match(calendarHook, /calendarGridWeekCount = 6/);
assert.match(calendarHook, /calendarWeekdayCount = 7/);
assert.match(calendarHook, /-monthStartDate\.getDay\(\)/);
assert.match(calendarPanel, /useCalendarMonthEvents/);
assert.match(calendarPanel, /@base-ui\/react\/dialog/);
assert.match(calendarPanel, /DialogPrimitive\.Root/);
assert.match(calendarPanel, /DialogPrimitive\.Popup/);
assert.match(calendarPanel, /DialogPrimitive\.Backdrop/);
assert.match(calendarPanel, /DialogPrimitive\.Close/);
assert.match(calendarPanel, /useAuthSession/);
assert.match(calendarPanel, /activeWorkspaceId/);
assert.match(calendarPanel, /authSession\?\.accessToken/);
assert.match(calendarPanel, /일정을 보려면 로그인이 필요합니다/);
assert.match(calendarPanel, /createCalendarApiClient/);
assert.match(calendarPanel, /getCalendarGridDates/);
assert.match(calendarPanel, /getEventsForCalendarDate/);
assert.match(calendarPanel, /CalendarEventSheet/);
assert.match(calendarPanel, /CalendarEventDetailDialog/);
assert.match(calendarPanel, /CalendarEventsDialog/);
assert.match(calendarPanel, /CalendarEventsDialogState/);
assert.match(calendarPanel, /detailEvent/);
assert.match(calendarPanel, /calendarAction/);
assert.match(calendarPanel, /readCalendarDraftFormState/);
assert.match(calendarPanel, /clearCalendarDraftSearchParams/);
assert.match(calendarPanel, /setSheetMode\(\{ type: "create" \}\)/);
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
