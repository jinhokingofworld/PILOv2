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
const MAX_CALENDAR_DESCRIPTION_LENGTH = 1000;
const MAX_MEETING_LIST_TEXT_LENGTH = 240;
const MAX_MEETING_DETAIL_TEXT_LENGTH = 800;
const MAX_ACTION_ITEMS = 5;
const MAX_ACTION_ITEM_TEXT_LENGTH = 240;
const MAX_BOARD_TITLE_LENGTH = 160;

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
    case "get_calendar_event":
      return formatCalendarEventDetail(input) ?? buildGenericAnswer(input);
    case "update_calendar_event":
      return formatCalendarUpdateClarification(input) ?? buildGenericAnswer(input);
    case "list_meeting_rooms":
      return formatMeetingRooms(input) ?? buildGenericAnswer(input);
    case "get_active_meeting":
      return formatActiveMeeting(input) ?? buildGenericAnswer(input);
    case "get_meeting_participants":
      return formatMeetingParticipants(input) ?? buildGenericAnswer(input);
    case "list_meeting_reports":
      return formatMeetingReportList(input) ?? buildGenericAnswer(input);
    case "get_meeting_report":
    case "summarize_meeting_report":
      return formatMeetingReportDetail(input) ?? buildGenericAnswer(input);
    case "search_board_issues":
      return formatBoardIssues(input) ?? buildGenericAnswer(input);
    case "resolve_board_context":
      return formatBoardResolution(input) ?? buildGenericAnswer(input);
    case "get_board_issue_context":
      return formatBoardIssueContext(input) ?? buildGenericAnswer(input);
    case "get_board_briefing":
      return formatBoardBriefing(input) ?? buildGenericAnswer(input);
    case "diagnose_board_freshness":
      return formatBoardFreshness(input) ?? buildGenericAnswer(input);
    case "focus_sql_erd_tables":
      return formatSqlErdTableFocus(input) ?? buildGenericAnswer(input);
    case "move_board_issue_status":
    case "create_board_issue":
    case "assign_board_issue_safely":
      return formatBoardClarification(input) ?? buildGenericAnswer(input);
    default:
      return buildGenericAnswer(input);
  }
}

function formatSqlErdTableFocus(input: AgentReadResultFormatterInput): string | null {
  if (readString(input.outputSummary.action) === "needs_clarification") {
    return (
      boundText(input.outputSummary.question, 240) ??
      "집중해서 볼 테이블 이름이나 기능 범위를 더 구체적으로 알려주세요."
    );
  }
  if (readString(input.outputSummary.action) !== "focused") {
    return null;
  }
  const title = boundText(input.outputSummary.title, 120);
  const featureLabel = boundText(input.outputSummary.featureLabel, 100);
  const primaryTables = readNamedItems(input.outputSummary.primaryTables, 5);
  const relatedTables = readNamedItems(input.outputSummary.relatedTables, 5);
  const selectedTables = [...primaryTables, ...relatedTables];

  if (selectedTables.length === 0) {
    return null;
  }

  return [
    `${title ?? "현재 ERD"}에서 ${featureLabel ?? "요청한 기능"} 관련 집중 보기 결과를 준비했습니다.`,
    `핵심 테이블: ${primaryTables.join(", ") || "없음"}`,
    ...(relatedTables.length > 0 ? [`관련 테이블: ${relatedTables.join(", ")}`] : [])
  ].join("\n");
}

function readNamedItems(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isPlainObject)
    .map((item) => boundText(item.name, 120))
    .filter((name): name is string => name !== null)
    .slice(0, limit);
}

function formatBoardResolution(
  input: AgentReadResultFormatterInput
): string | null {
  const clarification = formatBoardSelectionClarification(input.outputSummary);
  if (clarification) {
    return clarification;
  }
  if (readString(input.outputSummary.selection) !== "selected") {
    return null;
  }
  const board = isPlainObject(input.outputSummary.board)
    ? input.outputSummary.board
    : null;
  if (!board) {
    return null;
  }
  const name = boundText(board.name, 120);
  const repository = boundText(board.repository, 160);
  const source = readString(input.outputSummary.source);
  if (!name) {
    return null;
  }
  const sourceLabel =
    source === "active"
      ? "active Board"
      : source === "explicit"
        ? "명시한 Board"
        : "유일한 Board";
  return `${sourceLabel}로 ${name}${repository ? ` · ${repository}` : ""}를 선택했습니다.`;
}

function formatBoardIssueContext(
  input: AgentReadResultFormatterInput
): string | null {
  const clarification = formatBoardClarification(input);
  if (clarification) {
    return clarification;
  }
  const issue = isPlainObject(input.outputSummary.issue)
    ? input.outputSummary.issue
    : null;
  const related = isPlainObject(input.outputSummary.relatedPullRequests)
    ? input.outputSummary.relatedPullRequests
    : null;
  if (!issue || !related) {
    return null;
  }
  const issueNumber = boundText(issue.issueNumber, 40);
  const title = boundText(issue.title, MAX_BOARD_TITLE_LENGTH);
  if (!issueNumber || !title) {
    return null;
  }
  const state = readString(issue.state);
  const body = boundText(issue.body, 320);
  const pullRequestsValue = related.items;
  const pullRequests = Array.isArray(pullRequestsValue)
    ? pullRequestsValue.filter(isPlainObject).slice(0, MAX_LIST_ITEMS)
    : [];
  const relatedCount = Math.max(
    readCount(related.count) ?? 0,
    pullRequests.length
  );
  const answer = [
    `${issueNumber} · ${title}${state ? ` · ${state}` : ""}`
  ];
  if (body) {
    answer.push(`본문: ${body}`);
  }
  const labels = readBoundedStringList(issue.labels);
  answer.push(`라벨: ${formatBoundedList(labels)}`);
  const assignees = readBoundedStringList(issue.assignees);
  answer.push(`담당자: ${formatBoundedList(assignees)}`);
  const milestone = isPlainObject(issue.milestone) ? issue.milestone : null;
  const milestoneTitle = milestone ? boundText(milestone.title, 120) : null;
  if (milestoneTitle) {
    const milestoneState = boundText(milestone?.state, 40);
    const milestoneDueOn = boundText(milestone?.dueOn, 40);
    answer.push(
      `마일스톤: ${milestoneTitle}${milestoneState ? ` · ${milestoneState}` : ""}${milestoneDueOn ? ` · 마감 ${milestoneDueOn}` : ""}`
    );
  }
  const projectFieldsValue = issue.projectFields;
  const projectFields = Array.isArray(projectFieldsValue)
    ? projectFieldsValue.filter(isPlainObject).slice(0, MAX_LIST_ITEMS)
    : [];
  if (projectFields.length > 0) {
    answer.push("프로젝트 필드:");
    for (const field of projectFields) {
      const name = boundText(field.name, 120);
      const value = readBoardFieldValue(field);
      if (name) {
        answer.push(`- ${name}${value ? `: ${value}` : ""}`);
      }
    }
  }
  answer.push(
    `관련 PR ${relatedCount}개입니다. 동기화된 cache의 heuristic 연결 결과입니다.`
  );
  for (const pullRequest of pullRequests) {
    const number = readCount(pullRequest.number);
    const pullRequestTitle = boundText(pullRequest.title, MAX_BOARD_TITLE_LENGTH);
    const pullRequestState = readString(pullRequest.state);
    if (number !== null && pullRequestTitle) {
      answer.push(
        `- #${number} · ${pullRequestTitle}${pullRequestState ? ` · ${pullRequestState}` : ""}`
      );
    }
  }
  return answer.join("\n");
}

function formatBoardBriefing(
  input: AgentReadResultFormatterInput
): string | null {
  const clarification = formatBoardSelectionClarification(input.outputSummary);
  if (clarification) {
    return clarification;
  }
  const board = isPlainObject(input.outputSummary.board)
    ? input.outputSummary.board
    : null;
  const summary = isPlainObject(input.outputSummary.summary)
    ? input.outputSummary.summary
    : null;
  const columnsValue = input.outputSummary.columns;
  const columns = Array.isArray(columnsValue)
    ? columnsValue.filter(isPlainObject).slice(0, MAX_LIST_ITEMS)
    : [];
  if (!summary) {
    return null;
  }
  const boardName = board ? boundText(board.name, 120) : null;
  const totalCards = readCount(summary.totalCards);
  const openCards = readCount(summary.openCards);
  const closedCards = readCount(summary.closedCards);
  if (totalCards === null || openCards === null || closedCards === null) {
    return null;
  }
  const answer = [
    `${boardName ? `${boardName} Board` : "Board"}: 전체 ${totalCards}개 · open ${openCards}개 · closed ${closedCards}개`
  ];
  for (const column of columns) {
    const name = boundText(column.name, 120);
    const count = readCount(column.count);
    if (name && count !== null) {
      answer.push(`- ${name} ${count}개`);
    }
  }
  for (const distribution of [
    formatBoardDistribution("상태 분포", input.outputSummary.states, [
      "label",
      "value"
    ]),
    formatBoardDistribution("라벨 분포", input.outputSummary.labels, ["name"]),
    formatBoardDistribution("담당자 분포", input.outputSummary.assignees, [
      "login"
    ])
  ]) {
    if (distribution) {
      answer.push(distribution);
    }
  }
  const sync = isPlainObject(input.outputSummary.sync)
    ? input.outputSummary.sync
    : null;
  const syncStatus = sync ? readString(sync.status) : null;
  const lastSyncedAt = sync ? readString(sync.lastSyncedAt) : null;
  if (syncStatus || lastSyncedAt) {
    answer.push(
      `동기화: ${syncStatus ?? "unknown"}${lastSyncedAt ? ` · ${lastSyncedAt}` : ""}`
    );
  }
  return answer.join("\n");
}

function formatBoardFreshness(
  input: AgentReadResultFormatterInput
): string | null {
  const clarification = formatBoardSelectionClarification(input.outputSummary);
  if (clarification) {
    return clarification;
  }
  const active = isPlainObject(input.outputSummary.active)
    ? input.outputSummary.active
    : null;
  const sync = isPlainObject(input.outputSummary.sync)
    ? input.outputSummary.sync
    : null;
  const issues = isPlainObject(input.outputSummary.issueFreshness)
    ? input.outputSummary.issueFreshness
    : null;
  const pullRequests = isPlainObject(input.outputSummary.pullRequestFreshness)
    ? input.outputSummary.pullRequestFreshness
    : null;
  const unmapped = isPlainObject(input.outputSummary.unmapped)
    ? input.outputSummary.unmapped
    : null;
  if (!active || !sync || !issues || !pullRequests || !unmapped) {
    return null;
  }
  const status = readString(sync.status) ?? "unknown";
  const hydratedAt = readString(sync.lastHydratedAt);
  const sampled = readCount(issues.sampled) ?? 0;
  const total = readCount(issues.total) ?? sampled;
  const relatedCount = readCount(pullRequests.relatedCount) ?? 0;
  const unmappedCount = readCount(unmapped.count) ?? 0;
  const activeLabel =
    active.isActive === true
      ? "예"
      : active.isActive === false
        ? "아니요"
        : "확인 불가";
  const sourceUpdatedAt = boundText(active.sourceUpdatedAt, 80) ?? "없음";
  const sampleCompleteness =
    issues.complete === true
      ? "전체"
      : issues.complete === false
        ? "일부"
        : "확인 불가";
  const issueOldest = boundText(issues.oldestLastSyncedAt, 80) ?? "없음";
  const issueNewest = boundText(issues.newestLastSyncedAt, 80) ?? "없음";
  const pullRequestOldest =
    boundText(pullRequests.oldestLastSyncedAt, 80) ?? "없음";
  const pullRequestNewest =
    boundText(pullRequests.newestLastSyncedAt, 80) ?? "없음";
  const answer = [
    `동기화 상태: ${status}${hydratedAt ? ` · 마지막 hydration ${hydratedAt}` : ""}`,
    `이슈 freshness: ${total}개 중 ${sampled}개 확인`,
    `관련 PR freshness: ${relatedCount}개 확인`,
    `Unmapped ${unmappedCount}개`,
    "이 진단은 조회만 수행했으며 동기화를 실행하지 않았습니다."
  ];
  answer.push(
    `active Board: ${activeLabel} · source 갱신 ${sourceUpdatedAt}`,
    `이슈 표본: ${sampleCompleteness} · 가장 오래된 cache ${issueOldest} · 최신 cache ${issueNewest}`,
    `관련 PR cache: 가장 오래된 ${pullRequestOldest} · 최신 ${pullRequestNewest}`
  );
  return answer.join("\n");
}

function readBoundedStringList(value: unknown, limit = 80): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => boundText(item, limit))
    .filter((item): item is string => item !== null);
}

function formatBoundedList(values: string[]): string {
  const displayed = values.slice(0, MAX_LIST_ITEMS);
  if (displayed.length === 0) {
    return "없음";
  }
  const omitted = values.length - displayed.length;
  return `${displayed.join(", ")}${omitted > 0 ? ` 외 ${omitted}개` : ""}`;
}

function readBoardFieldValue(field: AgentJsonObject): string | null {
  for (const value of [
    field.option,
    field.iteration,
    field.text,
    field.date,
    field.number,
    field.type
  ]) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    const text = boundText(value, 160);
    if (text) {
      return text;
    }
  }
  return null;
}

function formatBoardDistribution(
  title: string,
  value: unknown,
  nameKeys: string[]
): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const formatted = value
    .filter(isPlainObject)
    .map((item) => {
      const name = nameKeys
        .map((key) => boundText(item[key], 80))
        .find((candidate): candidate is string => candidate !== null);
      const count = readCount(item.count);
      return name && count !== null ? `${name} ${count}개` : null;
    })
    .filter((item): item is string => item !== null)
    .slice(0, MAX_LIST_ITEMS);
  return formatted.length > 0 ? `${title}: ${formatted.join(", ")}` : null;
}

function formatBoardClarification(
  input: AgentReadResultFormatterInput
): string | null {
  const selection = formatBoardSelectionClarification(input.outputSummary);
  if (selection) {
    return selection;
  }
  if (input.outputSummary.status !== "needs_clarification") {
    return null;
  }
  switch (readString(input.outputSummary.reason)) {
    case "issue_not_found":
      return "지정한 GitHub issue 번호를 Board에서 찾지 못했습니다.";
    case "column_not_found": {
      const columnsValue = input.outputSummary.columns;
      const columns = Array.isArray(columnsValue)
        ? columnsValue
            .map((value) => boundText(value, 120))
            .filter((value): value is string => value !== null)
            .slice(0, MAX_LIST_ITEMS)
        : [];
      return [
        "지정한 Board column을 정확히 찾지 못했습니다.",
        ...columns.map((column) => `- ${column}`)
      ].join("\n");
    }
    case "unmapped_column_missing":
      return "기본 Unmapped column이 없어 이슈를 생성하지 않았습니다. GitHub repository 연결과 ProjectV2 Board 선택·동기화 상태를 확인해주세요.";
    case "assignee_not_assignable":
      return "저장소에 지정할 수 없는 GitHub 담당자가 포함되어 있어 변경하지 않았습니다.";
    case "assignee_limit_exceeded":
      return "담당자는 최대 10명까지 지정할 수 있어 변경하지 않았습니다.";
    case "assignee_no_changes":
      return "요청을 적용해도 담당자 목록이 바뀌지 않아 변경하지 않았습니다.";
    default:
      return null;
  }
}

function formatBoardSelectionClarification(
  outputSummary: AgentJsonObject
): string | null {
  const selection = readString(outputSummary.selection);
  if (selection === "none") {
    return "조회할 Board가 없습니다.";
  }
  if (selection !== "required") {
    return null;
  }
  const boardsValue = outputSummary.boards;
  const boards = Array.isArray(boardsValue)
    ? boardsValue.filter(isPlainObject).slice(0, MAX_LIST_ITEMS)
    : [];
  const candidates = boards
    .map((board) => {
      const name = boundText(board.name, 120);
      const repository = boundText(board.repository, 160);
      return name ? (repository ? `${name} · ${repository}` : name) : null;
    })
    .filter((value): value is string => value !== null);
  return [
    "조회할 Board를 정확히 지정해 주세요.",
    ...candidates.map((candidate) => `- ${candidate}`)
  ].join("\n");
}

function formatMeetingRooms(input: AgentReadResultFormatterInput): string | null {
  const roomsValue = input.outputSummary.rooms;
  if (!Array.isArray(roomsValue)) {
    return null;
  }

  const rooms = roomsValue.filter(isPlainObject);
  const total = Math.max(readCount(input.outputSummary.count) ?? 0, rooms.length);
  if (total === 0) {
    return "조회 가능한 회의방이 없습니다.";
  }

  const lines = rooms
    .map((room) => formatMeetingRoom(room, input.timezone))
    .filter((line): line is string => line !== null)
    .slice(0, MAX_LIST_ITEMS);
  if (lines.length === 0) {
    return null;
  }

  const answer = [`회의방 ${total}개입니다.`, ...lines.map((line) => `- ${line}`)];
  appendOmittedCount(answer, total, lines.length, "회의방");
  if (input.outputSummary.hasMore === true) {
    answer.push("추가 회의방이 있습니다.");
  }
  return answer.join("\n");
}

function formatMeetingRoom(
  room: AgentJsonObject,
  timezone: string | undefined
): string | null {
  const name = boundText(room.name, MAX_CALENDAR_TITLE_LENGTH);
  if (!name) {
    return null;
  }

  const currentMeeting = isPlainObject(room.currentMeeting)
    ? room.currentMeeting
    : null;
  if (!currentMeeting) {
    return `${name} · 진행 중인 회의 없음`;
  }

  const participantCount = readCount(currentMeeting.activeParticipantCount);
  const duration = formatDuration(readCount(currentMeeting.durationSec));
  const startedAt = formatIsoDateTime(currentMeeting.startedAt, timezone);
  const recording = isPlainObject(currentMeeting.recording)
    ? readString(currentMeeting.recording.status)
    : null;
  const details = [
    "진행 중",
    participantCount === null ? null : `${participantCount}명 참여`,
    duration ? `${duration} 경과` : null,
    recording === "RUNNING" ? "녹음 중" : null,
    startedAt ? `시작 ${startedAt}` : null
  ].filter((value): value is string => value !== null);

  return `${name} · ${details.join(" · ")}`;
}

function formatActiveMeeting(input: AgentReadResultFormatterInput): string | null {
  if (input.outputSummary.active !== true) {
    return "현재 참여 중인 회의가 없습니다.";
  }

  const meetingRoom = isPlainObject(input.outputSummary.meetingRoom)
    ? input.outputSummary.meetingRoom
    : null;
  const roomName = meetingRoom
    ? boundText(meetingRoom.name, MAX_CALENDAR_TITLE_LENGTH)
    : null;
  const duration = formatDuration(readCount(input.outputSummary.durationSec));
  const startedAt = formatIsoDateTime(
    isPlainObject(input.outputSummary.meeting)
      ? input.outputSummary.meeting.startedAt
      : null,
    input.timezone
  );

  if (!roomName && !duration && !startedAt) {
    return null;
  }

  const details = [
    roomName ? `${roomName} 회의에 참여 중입니다.` : "회의에 참여 중입니다.",
    duration ? `진행 시간: ${duration}` : null,
    startedAt ? `시작: ${startedAt}` : null
  ].filter((value): value is string => value !== null);
  return details.join(" ");
}

function formatMeetingParticipants(
  input: AgentReadResultFormatterInput
): string | null {
  const participantsValue = input.outputSummary.participants;
  if (!Array.isArray(participantsValue)) {
    return null;
  }

  const participants = participantsValue.filter(isPlainObject);
  const total = Math.max(
    readCount(input.outputSummary.count) ?? 0,
    participants.length
  );
  if (total === 0) {
    return "참여자가 없습니다.";
  }

  const lines = participants
    .map((participant) => formatMeetingParticipant(participant, input.timezone))
    .filter((line): line is string => line !== null)
    .slice(0, MAX_LIST_ITEMS);
  if (lines.length === 0) {
    return null;
  }

  const answer = [`참여자 ${total}명입니다.`, ...lines.map((line) => `- ${line}`)];
  appendOmittedCount(answer, total, lines.length, "참여자");
  if (input.outputSummary.hasMore === true) {
    answer.push("추가 참여자가 있습니다.");
  }
  return answer.join("\n");
}

function formatMeetingParticipant(
  participant: AgentJsonObject,
  timezone: string | undefined
): string | null {
  const name = boundText(participant.name, MAX_CALENDAR_TITLE_LENGTH);
  if (!name) {
    return null;
  }
  const joinedAt = formatIsoDateTime(participant.joinedAt, timezone);
  const leftAt = formatIsoDateTime(participant.leftAt, timezone);
  const status = participant.isActive === true ? "참여 중" : "퇴장";
  return [
    name,
    status,
    joinedAt ? `입장 ${joinedAt}` : null,
    leftAt ? `퇴장 ${leftAt}` : null
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
}

function formatCalendarUpdateClarification(
  input: AgentReadResultFormatterInput
): string | null {
  if (input.outputSummary.status !== "needs_clarification") {
    return null;
  }

  const selection = readString(input.outputSummary.selection);
  if (selection === "multiple") {
    return "조건에 맞는 일정이 여러 개라 수정하지 않았습니다. 대상 일정의 날짜와 시간을 더 구체적으로 알려주세요.";
  }

  if (selection === "none") {
    return "조건에 맞는 일정을 찾지 못해 수정하지 않았습니다. 대상 일정의 제목, 날짜, 시간을 더 구체적으로 알려주세요.";
  }

  return null;
}

function formatBoardIssues(input: AgentReadResultFormatterInput): string | null {
  const selection = readString(input.outputSummary.selection);
  const boardsValue = input.outputSummary.boards;
  const boards = Array.isArray(boardsValue)
    ? boardsValue.filter(isPlainObject)
    : [];

  if (selection === "none") {
    return "조회할 Board가 없습니다.";
  }

  if (selection === "required") {
    const candidates = boards
      .map((board) => {
        const name = boundText(board.name, 120);
        const repository = boundText(board.repository, 160);
        return name ? (repository ? `${name} · ${repository}` : name) : null;
      })
      .filter((value): value is string => value !== null)
      .slice(0, MAX_LIST_ITEMS);
    const answer = ["조회할 Board를 정확히 지정해 주세요."];
    if (candidates.length > 0) {
      answer.push(...candidates.map((candidate) => `- ${candidate}`));
    }
    return answer.join("\n");
  }

  if (selection !== "selected") {
    return null;
  }

  const board = isPlainObject(input.outputSummary.board)
    ? input.outputSummary.board
    : null;
  const boardName = board ? boundText(board.name, 120) : null;
  const issuesValue = input.outputSummary.issues;
  if (!Array.isArray(issuesValue)) {
    return null;
  }
  const issues = issuesValue.filter(isPlainObject);
  const total = Math.max(readCount(input.outputSummary.count) ?? 0, issues.length);
  const prefix = boardName ? `${boardName} Board` : "Board";
  if (total === 0) {
    return `${prefix}에서 조건에 맞는 이슈가 없습니다.`;
  }
  const lines = issues
    .map((issue) => formatBoardIssue(issue))
    .filter((line): line is string => line !== null)
    .slice(0, MAX_LIST_ITEMS);
  if (lines.length === 0) {
    return null;
  }
  const answer = [`${prefix} 이슈 ${total}개입니다.`, ...lines.map((line) => `- ${line}`)];
  appendOmittedCount(answer, total, lines.length, "이슈");
  return answer.join("\n");
}

function formatBoardIssue(issue: AgentJsonObject): string | null {
  const issueNumber = boundText(issue.issueNumber, 40);
  const title = boundText(issue.title, MAX_BOARD_TITLE_LENGTH);
  if (!issueNumber || !title) {
    return null;
  }
  const state = readString(issue.state);
  return `${issueNumber} · ${title}${state ? ` · ${state}` : ""}`;
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

function formatCalendarEventDetail(
  input: AgentReadResultFormatterInput
): string | null {
  if (readString(input.outputSummary.status) === "needs_clarification") {
    return (
      boundText(input.outputSummary.message, 240) ??
      "자세히 볼 Calendar 일정을 다시 선택해주세요."
    );
  }
  if (!isPlainObject(input.outputSummary.event)) {
    return null;
  }
  const event = input.outputSummary.event;
  const schedule = formatCalendarEvent(event);
  if (!schedule) {
    return null;
  }
  const description = boundText(
    event.description,
    MAX_CALENDAR_DESCRIPTION_LENGTH
  );
  const color = boundText(event.color, 20);
  const createdByName = boundText(event.createdByName, 120);
  const createdAt = boundText(event.createdAt, 40);
  const updatedAt = boundText(event.updatedAt, 40);

  return [
    schedule,
    `설명: ${description ?? "없음"}`,
    ...(color ? [`색상: ${color}`] : []),
    ...(createdByName ? [`등록자: ${createdByName}`] : []),
    ...(createdAt ? [`생성: ${createdAt}`] : []),
    ...(updatedAt ? [`마지막 수정: ${updatedAt}`] : [])
  ].join("\n");
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

    if (readString(report.status) === "FAILED") {
      answer.push(`  ${formatUnavailableMeetingReport(report)}`);
      continue;
    }

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
    const retryCount = readCount(report.retryCount);
    const retry = retryCount === null ? null : `재시도 ${retryCount}회`;
    return [
      failedStep
        ? `회의록 생성에 실패했습니다. 실패 단계: ${failedStep}`
        : "회의록 생성에 실패했습니다.",
      retry,
      "재생성 가능 여부를 확인한 뒤 요청할 수 있습니다."
    ]
      .filter((value): value is string => value !== null)
      .join(" ");
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

function formatDuration(value: number | null): string | null {
  if (value === null || value < 0) {
    return null;
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  }
  if (minutes > 0) {
    return `${minutes}분`;
  }
  return "1분 미만";
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
