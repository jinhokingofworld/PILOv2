import { createHash } from "node:crypto";
import type { AgentToolDefinition } from "./types/agent-tool.types";

export const AGENT_TOOL_CAPABILITY_CATALOG_VERSION =
  "agent-tool-capabilities:v1";

export interface AgentToolCapabilityDescriptor {
  toolName: string;
  domain: string;
  action: string;
  capabilityIds: string[];
  whenToUse: string;
  mustNotUseFor: string[];
  acceptedSelectorFields: string[];
  prerequisiteToolNames: string[];
  followUpToolNames: string[];
  riskLevel: AgentToolDefinition<unknown>["riskLevel"];
  executionMode: AgentToolDefinition<unknown>["executionMode"];
  contextSurface: string | null;
  inputSchemaSha256: string;
}

export interface AgentCapabilityDefinition {
  id: string;
  domain: string;
  toolNames: string[];
  whenToUse: string;
  mustNotUseFor: string[];
  positiveExamples: string[];
}

export interface AgentToolCapabilityCatalogSnapshot {
  version: string;
  sha256: string;
  capabilities: AgentCapabilityDefinition[];
  descriptors: AgentToolCapabilityDescriptor[];
}

const TOOL_DOMAIN_BY_NAME: Readonly<Record<string, string>> = {
  approve_meeting_report_action_item: "meeting",
  assign_board_issue_safely: "board",
  create_board_issue: "board",
  create_calendar_event: "calendar",
  delegate_canvas_agent: "canvas",
  diagnose_board_freshness: "board",
  dismiss_meeting_report_action_item: "meeting",
  end_meeting_recording: "meeting",
  find_action_items: "meeting",
  focus_sql_erd_tables: "sql_erd",
  generate_sql_erd: "sql_erd",
  get_active_meeting: "meeting",
  get_board_briefing: "board",
  get_board_issue_context: "board",
  get_meeting_decision_evidence: "meeting",
  get_meeting_participants: "meeting",
  get_meeting_report: "meeting",
  inspect_sql_erd_schema: "sql_erd",
  join_meeting: "meeting",
  leave_meeting: "meeting",
  list_calendar_events: "calendar",
  list_meeting_reports: "meeting",
  list_meeting_rooms: "meeting",
  move_board_issue_status: "board",
  recommend_pr_review_focus: "pr_review",
  regenerate_meeting_report: "meeting",
  resolve_board_context: "board",
  resolve_meeting_resource: "meeting",
  search_board_issues: "board",
  search_meeting_transcript: "meeting",
  search_workspace_documents: "drive",
  start_meeting_in_room: "meeting",
  start_meeting_recording: "meeting",
  summarize_meeting_report: "meeting",
  update_calendar_event: "calendar",
  update_meeting_report_action_item: "meeting"
};

const CAPABILITY_DEFINITIONS: AgentCapabilityDefinition[] = [
  capability("meeting.rooms.list", "meeting", ["list_meeting_rooms"], "회의방 또는 진행 중인 회의를 조회할 때", ["회의에 참여하거나 시작하는 요청"]),
  capability("meeting.control.start", "meeting", ["list_meeting_rooms", "start_meeting_in_room"], "특정 회의방에서 새 회의를 시작할 때", ["기존 회의 참여 또는 퇴장 요청"]),
  capability("meeting.control.join", "meeting", ["resolve_meeting_resource", "join_meeting"], "진행 중인 회의에 참여하거나 재입장할 때", ["회의 시작 또는 현재 회의 퇴장 요청"]),
  capability("meeting.control.leave", "meeting", ["get_active_meeting", "leave_meeting"], "현재 참여 중인 회의에서 나갈 때", ["다른 회의 참여 또는 회의 시작 요청"]),
  capability("meeting.recording.start", "meeting", ["get_active_meeting", "start_meeting_recording"], "현재 회의의 녹음을 시작할 때", ["녹음 종료 또는 회의록 조회 요청"]),
  capability("meeting.recording.end", "meeting", ["get_active_meeting", "end_meeting_recording"], "현재 회의의 녹음을 종료하고 회의록 생성을 요청할 때", ["녹음 시작 또는 회의 퇴장 요청"]),
  capability("meeting.participants.list", "meeting", ["resolve_meeting_resource", "get_meeting_participants"], "특정 회의의 현재 또는 과거 참여자를 조회할 때", ["회의록 또는 후속 작업 조회 요청"]),
  capability("meeting.reports.list", "meeting", ["list_meeting_reports"], "최근, 상태별 회의록 목록을 조회할 때", ["단일 회의록 상세 또는 요약 요청"]),
  capability("meeting.report.detail", "meeting", ["list_meeting_reports", "get_meeting_report"], "특정 회의록의 상태나 상세를 확인할 때", ["회의록 목록만 필요한 요청"]),
  capability("meeting.report.summary", "meeting", ["list_meeting_reports", "summarize_meeting_report"], "회의록의 요약, 결정사항, 논의, 후속 작업을 요청할 때", ["원문 근거 검색 요청"]),
  capability("meeting.evidence.search", "meeting", ["search_meeting_transcript"], "회의 발언 또는 Activity 근거를 검색할 때", ["결정 item에 직접 연결된 근거만 요청할 때"]),
  capability("meeting.decision.evidence", "meeting", ["list_meeting_reports", "get_meeting_decision_evidence"], "특정 결정사항의 직접 근거를 확인할 때", ["일반 회의 대화 검색 요청"]),
  capability("meeting.action_items.list", "meeting", ["find_action_items"], "담당자, 상태, 회의 기준으로 후속 작업을 찾을 때", ["후속 작업 변경, 승인 또는 반려 요청"]),
  capability("meeting.action_items.update", "meeting", ["find_action_items", "update_meeting_report_action_item"], "후속 작업의 담당자, 제목, 우선순위를 변경할 때", ["후속 작업 승인 또는 반려 요청"]),
  capability("meeting.action_items.dismiss", "meeting", ["find_action_items", "dismiss_meeting_report_action_item"], "후속 작업을 반려하거나 제외할 때", ["후속 작업 수정 또는 승인 요청"]),
  capability("meeting.action_items.approve", "meeting", ["find_action_items", "approve_meeting_report_action_item"], "후속 작업을 일정 또는 이슈로 승인할 때", ["후속 작업 수정 또는 반려 요청"]),
  capability("meeting.action_items.transfer_and_approve", "meeting", ["find_action_items", "update_meeting_report_action_item", "approve_meeting_report_action_item"], "후속 작업 담당자를 바꾸고 바로 승인할 때", ["담당자 변경만 하거나 반려하는 요청"]),
  capability("meeting.report.regenerate", "meeting", ["list_meeting_reports", "regenerate_meeting_report"], "실패한 회의록을 다시 생성할 때", ["회의록 조회 또는 요약 요청"]),
  capability("calendar.events.list", "calendar", ["list_calendar_events"], "기간의 일정 목록을 조회할 때", ["새 일정 생성 또는 기존 일정 변경 요청"]),
  capability("calendar.events.create", "calendar", ["create_calendar_event"], "새 일정을 생성할 때", ["기존 일정 변경 또는 회의록 조회 요청"]),
  capability("calendar.events.update", "calendar", ["list_calendar_events", "update_calendar_event"], "기존 일정의 시간이나 내용을 변경할 때", ["새 일정 생성 요청"]),
  capability("board.issues.search", "board", ["search_board_issues", "get_board_issue_context"], "이슈를 찾거나 현재 맥락을 확인할 때", ["이슈 생성 또는 상태 변경 요청"]),
  capability("board.issues.create", "board", ["create_board_issue"], "새 Board 이슈를 생성할 때", ["기존 이슈 담당자나 상태 변경 요청"]),
  capability("board.issues.move", "board", ["search_board_issues", "move_board_issue_status"], "기존 이슈 상태나 컬럼을 변경할 때", ["이슈 생성 또는 담당자 변경 요청"]),
  capability("board.issues.assign", "board", ["search_board_issues", "assign_board_issue_safely"], "기존 이슈의 담당자를 변경할 때", ["이슈 상태 변경 또는 생성 요청"]),
  capability("board.briefing", "board", ["get_board_briefing", "diagnose_board_freshness", "resolve_board_context"], "Board 현황, 동기화 상태, context를 확인할 때", ["이슈 mutation 요청"]),
  capability("sql_erd.inspect", "sql_erd", ["inspect_sql_erd_schema", "focus_sql_erd_tables"], "SQLtoERD schema나 특정 table을 살펴볼 때", ["schema 생성 요청"]),
  capability("sql_erd.generate", "sql_erd", ["generate_sql_erd"], "SQL로 ERD를 생성할 때", ["기존 schema inspection 요청"]),
  capability("canvas.delegate", "canvas", ["delegate_canvas_agent"], "Canvas 작업을 Agent에게 위임할 때", ["SQLtoERD 또는 Board 요청"]),
  capability("pr_review.focus", "pr_review", ["recommend_pr_review_focus"], "PR review에서 우선 확인할 변경을 추천받을 때", ["Board 또는 Meeting 요청"]),
  capability("drive.documents.search", "drive", ["search_workspace_documents"], "Workspace 문서를 검색할 때", ["회의 transcript 또는 Board issue 검색 요청"])
];

export function buildAgentToolCapabilityCatalog(
  definitions: AgentToolDefinition<unknown>[]
): AgentToolCapabilityCatalogSnapshot {
  const capabilities = CAPABILITY_DEFINITIONS.filter((capability) =>
    capability.toolNames.every((toolName) =>
      definitions.some((definition) => definition.name === toolName)
    )
  );
  const descriptors = definitions
    .map((definition) => toDescriptor(definition, capabilities))
    .sort((left, right) => left.toolName.localeCompare(right.toolName));
  validateCapabilityCatalog(capabilities, descriptors, definitions);
  const canonical = {
    version: AGENT_TOOL_CAPABILITY_CATALOG_VERSION,
    capabilities,
    descriptors
  };

  return {
    version: AGENT_TOOL_CAPABILITY_CATALOG_VERSION,
    sha256: hashCanonicalJson(canonical),
    capabilities,
    descriptors
  };
}

function toDescriptor(
  definition: AgentToolDefinition<unknown>,
  capabilities: AgentCapabilityDefinition[]
): AgentToolCapabilityDescriptor {
  const domain = TOOL_DOMAIN_BY_NAME[definition.name];
  if (!domain) {
    throw new Error(
      `Agent tool capability descriptor is missing for ${definition.name}`
    );
  }

  const matchingCapabilities = capabilities.filter((capability) =>
    capability.toolNames.includes(definition.name)
  );
  if (!matchingCapabilities.length) {
    throw new Error(
      `Agent tool capability definition is missing for ${definition.name}`
    );
  }

  const prerequisiteToolNames = new Set<string>();
  const followUpToolNames = new Set<string>();
  for (const capability of matchingCapabilities) {
    const index = capability.toolNames.indexOf(definition.name);
    capability.toolNames.slice(0, index).forEach((name) => prerequisiteToolNames.add(name));
    capability.toolNames.slice(index + 1).forEach((name) => followUpToolNames.add(name));
  }

  return {
    toolName: definition.name,
    domain,
    action: definition.name,
    capabilityIds: matchingCapabilities.map((capability) => capability.id),
    whenToUse: matchingCapabilities.map((capability) => capability.whenToUse).join(" "),
    mustNotUseFor: [...new Set(matchingCapabilities.flatMap((capability) => capability.mustNotUseFor))],
    acceptedSelectorFields: Object.keys(
      (definition.inputSchema.properties as Record<string, unknown> | undefined) ?? {}
    ).sort(),
    prerequisiteToolNames: [...prerequisiteToolNames].sort(),
    followUpToolNames: [...followUpToolNames].sort(),
    riskLevel: definition.riskLevel,
    executionMode: definition.executionMode,
    contextSurface: definition.contextRequirement?.surface ?? null,
    inputSchemaSha256: hashCanonicalJson(definition.inputSchema)
  };
}

function capability(
  id: string,
  domain: string,
  toolNames: string[],
  whenToUse: string,
  mustNotUseFor: string[]
): AgentCapabilityDefinition {
  return {
    id,
    domain,
    toolNames,
    whenToUse,
    mustNotUseFor,
    positiveExamples: [whenToUse]
  };
}

function hashCanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

function validateCapabilityCatalog(
  capabilities: AgentCapabilityDefinition[],
  descriptors: AgentToolCapabilityDescriptor[],
  definitions: AgentToolDefinition<unknown>[]
): void {
  const registeredToolNames = new Set(definitions.map((definition) => definition.name));
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  if (capabilityIds.size !== capabilities.length) {
    throw new Error("Agent capability catalog contains duplicate capability IDs");
  }
  if (
    capabilities.some(
      (capability) =>
        !capability.toolNames.length ||
        !capability.whenToUse ||
        !capability.mustNotUseFor.length ||
        !capability.positiveExamples.length ||
        capability.toolNames.some((toolName) => !registeredToolNames.has(toolName))
    )
  ) {
    throw new Error("Agent capability catalog contains an invalid capability");
  }
  if (
    descriptors.length !== definitions.length ||
    descriptors.some(
      (descriptor) =>
        !registeredToolNames.has(descriptor.toolName) ||
        !descriptor.capabilityIds.length ||
        !descriptor.whenToUse ||
        !descriptor.mustNotUseFor.length ||
        !descriptor.inputSchemaSha256 ||
        descriptor.capabilityIds.some((id) => !capabilityIds.has(id))
    )
  ) {
    throw new Error("Agent capability catalog contains an invalid tool descriptor");
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}
