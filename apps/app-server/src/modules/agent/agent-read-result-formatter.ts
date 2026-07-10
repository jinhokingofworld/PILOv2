import type {
  AgentJsonObject,
  AgentResourceRef
} from "./types/agent-tool.types";

export interface AgentReadResultFormatterInput {
  toolName: string;
  outputSummary: AgentJsonObject;
  resourceRefs: AgentResourceRef[];
  prompt?: string;
  timezone?: string;
}

type MeetingSectionKey =
  | "summary"
  | "discussionPoints"
  | "decisions"
  | "actionItems";

interface MeetingSectionDefinition {
  key: MeetingSectionKey;
  title: string;
  patterns: RegExp[];
}

const DEFAULT_TIMEZONE = "Asia/Seoul";
const MAX_LIST_ITEMS = 5;
const MAX_CALENDAR_TITLE_LENGTH = 120;
const MAX_MEETING_LIST_TEXT_LENGTH = 240;
const MAX_MEETING_DETAIL_TEXT_LENGTH = 800;
const MAX_ACTION_ITEMS = 5;
const MAX_ACTION_ITEM_TEXT_LENGTH = 240;

const MEETING_SECTIONS: readonly MeetingSectionDefinition[] = [
  {
    key: "summary",
    title: "요약",
    patterns: [/요약/, /요점/, /핵심/]
  },
  {
    key: "discussionPoints",
    title: "논의사항",
    patterns: [/논의/, /토론/]
  },
  {
    key: "decisions",
    title: "결정사항",
    patterns: [/결정/, /합의/, /결론/]
  },
  {
    key: "actionItems",
    title: "후속 작업",
    patterns: [
      /후속\s*작업/,
      /액션\s*아이템/,
      /할\s*일/,
      /해야\s*할\s*(일|작업)/,
      /todo/i,
      /to-do/i
    ]
  }
];
const MEETING_EXCLUSION_PATTERN =
  /말고|빼(?:고|줘|주세요)|제외(?:하고|해줘|해주세요|한|해|하여)?|없이|생략(?:하고|해줘|해주세요|한|해)?|필요\s*없(?:고|어|습니다)?|안\s*(?:보여|알려)(?:줘|주고|주세요)?/g;
const MEETING_CLAUSE_BREAK_PATTERN =
  /[.!?;\n]|(?:보여|알려|포함|출력)(?:줘|주세요|주고|달라|주되)/g;

export function buildAgentReadResultAnswer(
  input: AgentReadResultFormatterInput
): string {
  switch (input.toolName) {
    case "list_calendar_events":
      return formatCalendarEvents(input) ?? buildGenericAnswer(input);
    case "list_meeting_reports":
      return formatMeetingReportList(input) ?? buildGenericAnswer(input);
    case "get_meeting_report":
    case "summarize_meeting_report":
      return formatMeetingReportDetail(input) ?? buildGenericAnswer(input);
    default:
      return buildGenericAnswer(input);
  }
}

function formatCalendarEvents(
  input: AgentReadResultFormatterInput
): string | null {
  const eventsValue = input.outputSummary.events;
  if (!Array.isArray(eventsValue)) {
    return null;
  }

  const events = eventsValue.filter(isPlainObject);
  const start = readString(input.outputSummary.start);
  const end = readString(input.outputSummary.end);
  const total = Math.max(readCount(input.outputSummary.count) ?? 0, events.length);
  const rangeLabel = formatDateRange(start, end);

  if (total === 0) {
    return rangeLabel ? `${rangeLabel} 일정이 없습니다.` : "일정이 없습니다.";
  }

  const lines = events
    .map((event) => formatCalendarEvent(event))
    .filter((line): line is string => line !== null)
    .slice(0, MAX_LIST_ITEMS);

  if (lines.length === 0) {
    return null;
  }

  const answer = [
    rangeLabel
      ? `${rangeLabel} 일정 ${total}개입니다.`
      : `일정 ${total}개입니다.`,
    ...lines.map((line) => `- ${line}`)
  ];
  appendOmittedCount(answer, total, lines.length, "일정");

  return answer.join("\n");
}

function formatCalendarEvent(event: AgentJsonObject): string | null {
  const title = boundText(event.title, MAX_CALENDAR_TITLE_LENGTH);
  const startDate = readString(event.startDate);
  const endDate = readString(event.endDate) ?? startDate;
  if (!title || !startDate || !endDate) {
    return null;
  }

  const isAllDay = event.isAllDay === true;
  if (isAllDay) {
    const dateLabel =
      startDate === endDate ? startDate : `${startDate}~${endDate}`;
    return `${dateLabel} 종일 · ${title}`;
  }

  const startTime = readString(event.startTime);
  const endTime = readString(event.endTime);
  if (!startTime) {
    return `${startDate} 시간 미정 · ${title}`;
  }

  const startLabel = `${startDate} ${startTime}`;
  const endLabel = endTime
    ? startDate === endDate
      ? endTime
      : `${endDate} ${endTime}`
    : null;
  const schedule = endLabel ? `${startLabel}-${endLabel}` : startLabel;

  return `${schedule} · ${title}`;
}

function formatMeetingReportList(
  input: AgentReadResultFormatterInput
): string | null {
  const reportsValue = input.outputSummary.reports;
  if (!Array.isArray(reportsValue)) {
    return null;
  }

  const reports = reportsValue.filter(isPlainObject);
  const total = Math.max(readCount(input.outputSummary.count) ?? 0, reports.length);
  if (total === 0) {
    return "조회된 회의록이 없습니다.";
  }

  const selection = selectMeetingSections(input.prompt);
  const sectionKeys = selection.explicit ? selection.keys : ["summary" as const];
  const displayedReports = reports.slice(0, MAX_LIST_ITEMS);
  if (displayedReports.length === 0) {
    return null;
  }

  const answer = [`회의록 ${total}개입니다.`];
  for (const report of displayedReports) {
    const createdAt = formatIsoDateTime(report.createdAt, input.timezone);
    const status = formatMeetingStatus(report.status);
    answer.push(`- ${createdAt ? `${createdAt} · ` : ""}${status}`);

    for (const key of sectionKeys) {
      answer.push(
        ...formatMeetingSection(report, key, {
          indent: "  ",
          textLimit: MAX_MEETING_LIST_TEXT_LENGTH
        })
      );
    }
  }

  appendOmittedCount(answer, total, displayedReports.length, "회의록");
  return answer.join("\n");
}

function formatMeetingReportDetail(
  input: AgentReadResultFormatterInput
): string | null {
  const report = input.outputSummary.report;
  if (!isPlainObject(report)) {
    return null;
  }

  const createdAt = formatIsoDateTime(report.createdAt, input.timezone);
  const status = formatMeetingStatus(report.status);
  const answer = [
    `회의록${createdAt ? ` · ${createdAt}` : ""} · ${status}`
  ];
  const selection = selectMeetingSections(input.prompt);
  const sectionKeys = selection.explicit
    ? selection.keys
    : MEETING_SECTIONS.map((section) => section.key);

  if (!selection.explicit && !hasMeetingContent(report)) {
    answer.push(formatUnavailableMeetingReport(report));
    return answer.join("\n");
  }

  for (const key of sectionKeys) {
    answer.push(
      ...formatMeetingSection(report, key, {
        indent: "",
        textLimit: MAX_MEETING_DETAIL_TEXT_LENGTH
      })
    );
  }

  return answer.join("\n");
}

function formatMeetingSection(
  report: AgentJsonObject,
  key: MeetingSectionKey,
  options: { indent: string; textLimit: number }
): string[] {
  const definition = MEETING_SECTIONS.find((section) => section.key === key);
  if (!definition) {
    return [];
  }

  if (key === "actionItems") {
    return formatActionItems(report, definition.title, options);
  }

  const text = readMeetingSectionText(report, key, options.textLimit);
  return [
    `${options.indent}${definition.title}: ${text ?? missingMeetingContent(report)}`
  ];
}

function formatActionItems(
  report: AgentJsonObject,
  title: string,
  options: { indent: string; textLimit: number }
): string[] {
  const actionItemsValue = report.actionItems;
  const actionItems = Array.isArray(actionItemsValue)
    ? actionItemsValue.filter(isPlainObject)
    : [];
  const formatted = actionItems
    .map((item) => {
      const itemTitle = boundText(item.title, MAX_ACTION_ITEM_TEXT_LENGTH);
      if (!itemTitle) {
        return null;
      }

      const description = boundText(
        item.description,
        Math.min(options.textLimit, MAX_ACTION_ITEM_TEXT_LENGTH)
      );
      return description ? `${itemTitle}: ${description}` : itemTitle;
    })
    .filter((item): item is string => item !== null)
    .slice(0, MAX_ACTION_ITEMS);

  if (formatted.length === 0) {
    return [`${options.indent}${title}: ${missingMeetingContent(report)}`];
  }

  const lines = [`${options.indent}${title}:`];
  lines.push(...formatted.map((item) => `${options.indent}- ${item}`));
  if (actionItems.length > formatted.length) {
    lines.push(
      `${options.indent}- 외 ${actionItems.length - formatted.length}개 후속 작업`
    );
  }
  return lines;
}

function readMeetingSectionText(
  report: AgentJsonObject,
  key: MeetingSectionKey,
  limit: number
): string | null {
  const sectionsValue = report.sections;
  if (!Array.isArray(sectionsValue)) {
    return null;
  }

  for (const section of sectionsValue) {
    if (!isPlainObject(section) || readString(section.key) !== key) {
      continue;
    }

    return boundText(section.text, limit);
  }

  return null;
}

function selectMeetingSections(prompt: string | undefined): {
  explicit: boolean;
  keys: MeetingSectionKey[];
} {
  const normalizedPrompt = prompt?.trim() ?? "";
  const mentionedKeys = MEETING_SECTIONS.filter((section) =>
    section.patterns.some((pattern) => pattern.test(normalizedPrompt))
  ).map((section) => section.key);
  const excludedKeys = findExcludedMeetingSections(normalizedPrompt);
  const includedKeys = mentionedKeys.filter((key) => !excludedKeys.has(key));
  const keys =
    includedKeys.length > 0
      ? includedKeys
      : excludedKeys.size > 0
        ? MEETING_SECTIONS.map((section) => section.key).filter(
            (key) => !excludedKeys.has(key)
          )
        : mentionedKeys;

  return {
    explicit: mentionedKeys.length > 0 || excludedKeys.size > 0,
    keys
  };
}

function findExcludedMeetingSections(prompt: string): Set<MeetingSectionKey> {
  const excluded = new Set<MeetingSectionKey>();

  for (const marker of prompt.matchAll(MEETING_EXCLUSION_PATTERN)) {
    const markerIndex = marker.index;
    if (markerIndex === undefined) {
      continue;
    }

    const beforeMarker = prompt.slice(0, markerIndex);
    const clause = beforeMarker.slice(findLastMeetingClauseBreak(beforeMarker));
    for (const section of MEETING_SECTIONS) {
      if (section.patterns.some((pattern) => pattern.test(clause))) {
        excluded.add(section.key);
      }
    }
  }

  return excluded;
}

function findLastMeetingClauseBreak(input: string): number {
  let clauseStart = 0;
  for (const match of input.matchAll(MEETING_CLAUSE_BREAK_PATTERN)) {
    if (match.index !== undefined) {
      clauseStart = match.index + match[0].length;
    }
  }
  return clauseStart;
}

function hasMeetingContent(report: AgentJsonObject): boolean {
  const hasSection = MEETING_SECTIONS.slice(0, 3).some(
    (section) => readMeetingSectionText(report, section.key, 1) !== null
  );
  const actionItems = report.actionItems;
  return hasSection || (Array.isArray(actionItems) && actionItems.length > 0);
}

function formatUnavailableMeetingReport(report: AgentJsonObject): string {
  const status = readString(report.status);
  if (status === "PROCESSING") {
    return "회의록을 생성하고 있습니다.";
  }

  if (status === "FAILED") {
    const failure = isPlainObject(report.failure) ? report.failure : null;
    const failedStep = failure ? readString(failure.failedStep) : null;
    return failedStep
      ? `회의록 생성에 실패했습니다. 실패 단계: ${failedStep}`
      : "회의록 생성에 실패했습니다.";
  }

  return "표시할 회의록 내용이 없습니다.";
}

function missingMeetingContent(report: AgentJsonObject): string {
  const status = readString(report.status);
  if (status === "PROCESSING") {
    return "아직 생성 중입니다.";
  }
  if (status === "FAILED") {
    return "생성에 실패했습니다.";
  }
  return "내용이 없습니다.";
}

function formatMeetingStatus(value: unknown): string {
  switch (readString(value)) {
    case "COMPLETED":
      return "완료";
    case "PROCESSING":
      return "생성 중";
    case "FAILED":
      return "생성 실패";
    default:
      return "상태 확인 필요";
  }
}

function formatIsoDateTime(value: unknown, timezone: string | undefined): string | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const format = (timeZone: string): string => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) {
      parts[part.type] = part.value;
    }

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };

  try {
    return format(timezone?.trim() || DEFAULT_TIMEZONE);
  } catch {
    return format(DEFAULT_TIMEZONE);
  }
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) {
    return null;
  }
  if (!start) {
    return end;
  }
  if (!end || start === end) {
    return start;
  }
  return `${start}~${end}`;
}

function appendOmittedCount(
  lines: string[],
  total: number,
  displayed: number,
  label: string
): void {
  const omitted = total - displayed;
  if (omitted > 0) {
    lines.push(`외 ${omitted}개 ${label}이 있습니다.`);
  }
}

function buildGenericAnswer(input: AgentReadResultFormatterInput): string {
  if (input.resourceRefs.length === 0) {
    return `${input.toolName} 실행을 완료했습니다.`;
  }

  return `${input.toolName} 실행을 완료했습니다. 관련 리소스 ${input.resourceRefs.length}개를 확인했습니다.`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function boundText(value: unknown, limit: number): string | null {
  const text = readString(value)?.replace(/\s+/g, " ") ?? null;
  if (!text) {
    return null;
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function isPlainObject(value: unknown): value is AgentJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
