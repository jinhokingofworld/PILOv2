import { createHash } from "node:crypto";
import type { AgentToolDefinition } from "./types/agent-tool.types";

export const AGENT_TOOL_CAPABILITY_CATALOG_VERSION =
  "agent-tool-capabilities:v2";

export type AgentCapabilityAvailability = "supported" | "unsupported";

export type AgentCapabilityExampleKind =
  | "canonical"
  | "paraphrase"
  | "typo"
  | "honorific"
  | "abbreviation";

export interface AgentCapabilityExample {
  kind: AgentCapabilityExampleKind;
  utterance: string;
}

export type AgentToolOperation = "read" | "write";

export interface AgentToolCapabilityDescriptor {
  toolName: string;
  domain: string;
  action: string;
  operation: AgentToolOperation;
  capabilityIds: string[];
  whenToUse: string;
  mustNotUseFor: string[];
  acceptedSelectorFields: string[];
  selectorKinds: string[];
  prerequisiteToolNames: string[];
  followUpToolNames: string[];
  riskLevel: AgentToolDefinition<unknown>["riskLevel"];
  executionMode: AgentToolDefinition<unknown>["executionMode"];
  requiresConfirmation: boolean;
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
  examples: AgentCapabilityExample[];
  selectorKinds: string[];
  requiresConfirmation: boolean;
  availability: AgentCapabilityAvailability;
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

const TOOL_OPERATION_BY_NAME: Readonly<Record<string, AgentToolOperation>> = {
  approve_meeting_report_action_item: "write",
  assign_board_issue_safely: "write",
  create_board_issue: "write",
  create_calendar_event: "write",
  delegate_canvas_agent: "write",
  diagnose_board_freshness: "read",
  dismiss_meeting_report_action_item: "write",
  end_meeting_recording: "write",
  find_action_items: "read",
  focus_sql_erd_tables: "read",
  generate_sql_erd: "write",
  get_active_meeting: "read",
  get_board_briefing: "read",
  get_board_issue_context: "read",
  get_meeting_decision_evidence: "read",
  get_meeting_participants: "read",
  get_meeting_report: "read",
  inspect_sql_erd_schema: "read",
  join_meeting: "write",
  leave_meeting: "write",
  list_calendar_events: "read",
  list_meeting_reports: "read",
  list_meeting_rooms: "read",
  move_board_issue_status: "write",
  recommend_pr_review_focus: "read",
  regenerate_meeting_report: "write",
  resolve_board_context: "read",
  resolve_meeting_resource: "read",
  search_board_issues: "read",
  search_meeting_transcript: "read",
  search_workspace_documents: "read",
  start_meeting_in_room: "write",
  start_meeting_recording: "write",
  summarize_meeting_report: "read",
  update_calendar_event: "write",
  update_meeting_report_action_item: "write"
};

export function getAgentToolDomainAndOperation(
  toolName: string
): { domain: string; operation: AgentToolOperation } | null {
  const domain = TOOL_DOMAIN_BY_NAME[toolName];
  const operation = TOOL_OPERATION_BY_NAME[toolName];
  return domain && operation ? { domain, operation } : null;
}

const CAPABILITY_DEFINITIONS: AgentCapabilityDefinition[] = [
  capability("meeting.rooms.list", "meeting", ["list_meeting_rooms"], "회의방 또는 진행 중인 회의를 조회할 때", ["회의에 참여하거나 시작하는 요청"]),
  capability("meeting.control.start", "meeting", ["list_meeting_rooms", "start_meeting_in_room"], "특정 회의방에서 새 회의를 시작할 때", ["기존 회의 참여 또는 퇴장 요청"]),
  capability("meeting.control.join", "meeting", ["resolve_meeting_resource", "join_meeting"], "진행 중인 회의에 참여하거나 재입장할 때", ["회의 시작 또는 현재 회의 퇴장 요청"]),
  capability("meeting.control.leave", "meeting", ["get_active_meeting", "leave_meeting"], "현재 참여 중인 회의에서 나갈 때", ["다른 회의 참여 또는 회의 시작 요청"], ["현재 회의에서 나가줘", "회의 나가줘"]),
  capability("meeting.recording.start", "meeting", ["get_active_meeting", "start_meeting_recording"], "현재 회의의 녹음을 시작할 때", ["녹음 종료 또는 회의록 조회 요청"]),
  capability("meeting.recording.end", "meeting", ["get_active_meeting", "end_meeting_recording"], "현재 회의의 녹음을 종료하고 회의록 생성을 요청할 때", ["녹음 시작 또는 회의 퇴장 요청"]),
  capability("meeting.participants.list", "meeting", ["resolve_meeting_resource", "get_meeting_participants"], "특정 회의의 현재 또는 과거 참여자를 조회할 때", ["회의록 또는 후속 작업 조회 요청"]),
  capability("meeting.reports.list", "meeting", ["list_meeting_reports"], "최신 N건 또는 기간별 회의록 목록을 조회할 때", ["단일 회의록 상세 또는 요약 요청"], ["최근 회의록 보여줘", "최근 3건 회의록"]),
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
  capability(
    "calendar.events.list",
    "calendar",
    ["list_calendar_events"],
    "기간의 일정 목록을 조회할 때",
    ["새 일정 생성 또는 기존 일정 변경 요청"],
    ["일정 보여줘", "이번 주 일정 알려줘"]
  ),
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
  capability(
    "canvas.drive_images.import",
    "canvas",
    ["delegate_canvas_agent"],
    "Workspace Drive의 기존 이미지를 Canvas에 가져올 때",
    ["일반 문서 검색 또는 Canvas 도형 직접 수정 요청"],
    [
      "드라이브에서 아키텍처 이미지를 캔버스에 올려줘",
      "공유 드라이브의 팀 로고 이미지를 캔버스에 추가해줘"
    ]
  ),
  capability("pr_review.focus", "pr_review", ["recommend_pr_review_focus"], "PR review에서 우선 확인할 변경을 추천받을 때", ["Board 또는 Meeting 요청"]),
  capability("drive.documents.search", "drive", ["search_workspace_documents"], "Workspace 문서를 검색할 때", ["회의 transcript 또는 Board issue 검색 요청"]),
  unsupportedCapability("meeting.action_items.create", "meeting", "회의록에 없는 새 후속 작업을 추가할 때", ["새 회의 할 일 추가", "회의록에 액션 아이템 넣어줘"]),
  unsupportedCapability("calendar.events.delete", "calendar", "기존 Calendar 일정을 삭제할 때", ["내일 일정 삭제", "캘린더 이벤트 지워줘"]),
  unsupportedCapability("board.issues.delete", "board", "GitHub Board Issue를 삭제할 때", ["보드 이슈 삭제", "이슈 지워줘"]),
  unsupportedCapability("canvas.shapes.mutate", "canvas", "Canvas 도형을 직접 생성·수정·삭제할 때", ["캔버스 도형 직접 수정", "도형 지워줘"]),
  unsupportedCapability("sql_erd.sql.execute", "sql_erd", "SQL을 데이터베이스에서 실행할 때", ["SQL 실행", "DDL 돌려줘"]),
  unsupportedCapability("drive.documents.write", "drive", "Workspace 문서를 생성·수정·삭제할 때", ["문서 수정", "파일 삭제"]),
  unsupportedCapability("pr_review.submit", "pr_review", "GitHub PR Review를 제출하거나 merge할 때", ["PR 리뷰 제출", "PR 머지"])
];

export function getAgentCapabilityToolNames(
  capabilityId: string
): readonly string[] | null {
  return (
    CAPABILITY_DEFINITIONS.find(
      (capability) =>
        capability.id === capabilityId &&
        capability.availability === "supported"
    )?.toolNames ?? null
  );
}

export function isTerminalAgentCapabilityTool(
  capabilityIds: readonly string[],
  toolName: string,
  completedToolNames: readonly string[] = []
): boolean {
  if (capabilityIds.length === 0) {
    return false;
  }
  const chains = capabilityIds.map(getAgentCapabilityToolNames);
  const satisfiedToolNames = new Set([...completedToolNames, toolName]);
  return (
    chains.every((chain) => chain !== null && chain.length > 0) &&
    chains.every((chain) =>
      chain?.every((requiredToolName) => satisfiedToolNames.has(requiredToolName))
    )
  );
}

export function buildAgentToolCapabilityCatalog(
  definitions: AgentToolDefinition<unknown>[]
): AgentToolCapabilityCatalogSnapshot {
  const capabilities = CAPABILITY_DEFINITIONS.filter(
    (capability) =>
      capability.availability === "unsupported" ||
      capability.toolNames.every((toolName) =>
        definitions.some((definition) => definition.name === toolName)
      )
  ).map((capability) => ({
    ...capability,
    requiresConfirmation:
      capability.availability === "supported" &&
      definitions.some(
        (definition) =>
          definition.name === capability.toolNames.at(-1) &&
          definition.executionMode === "confirmation_required"
      )
  }));
  const descriptors = definitions
    .map((definition) => toDescriptor(definition, capabilities))
    .sort((left, right) => left.toolName.localeCompare(right.toolName));
  validateAgentToolCapabilityCatalog(capabilities, descriptors, definitions);
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
  const operation = TOOL_OPERATION_BY_NAME[definition.name];
  if (!operation) {
    throw new Error(
      `Agent tool operation inventory is missing for ${definition.name}`
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
    operation,
    capabilityIds: matchingCapabilities.map((capability) => capability.id),
    whenToUse: matchingCapabilities.map((capability) => capability.whenToUse).join(" "),
    mustNotUseFor: [...new Set(matchingCapabilities.flatMap((capability) => capability.mustNotUseFor))],
    acceptedSelectorFields: Object.keys(
      (definition.inputSchema.properties as Record<string, unknown> | undefined) ?? {}
    ).sort(),
    selectorKinds: [
      ...new Set(matchingCapabilities.flatMap((capability) => capability.selectorKinds))
    ].sort(),
    prerequisiteToolNames: [...prerequisiteToolNames].sort(),
    followUpToolNames: [...followUpToolNames].sort(),
    riskLevel: definition.riskLevel,
    executionMode: definition.executionMode,
    requiresConfirmation: definition.executionMode === "confirmation_required",
    contextSurface: definition.contextRequirement?.surface ?? null,
    inputSchemaSha256: hashCanonicalJson(definition.inputSchema)
  };
}

function capability(
  id: string,
  domain: string,
  toolNames: string[],
  whenToUse: string,
  mustNotUseFor: string[],
  positiveExamples: string[] = []
): AgentCapabilityDefinition {
  const examples = capabilityExamples(id, domain, whenToUse, positiveExamples);
  return {
    id,
    domain,
    toolNames,
    whenToUse,
    mustNotUseFor,
    positiveExamples: examples.map((example) => example.utterance),
    examples,
    selectorKinds: selectorKindsFor(id),
    requiresConfirmation: false,
    availability: "supported"
  };
}

function unsupportedCapability(
  id: string,
  domain: string,
  whenToUse: string,
  positiveExamples: string[]
): AgentCapabilityDefinition {
  const canonical = positiveExamples[0] ?? whenToUse;
  const examples = capabilityExamples(id, domain, canonical, positiveExamples);
  return {
    id,
    domain,
    toolNames: [],
    whenToUse,
    mustNotUseFor: ["현재 Agent registry에 실행 tool이 없는 요청"],
    positiveExamples: examples.map((example) => example.utterance),
    examples,
    selectorKinds: selectorKindsFor(id),
    requiresConfirmation: false,
    availability: "unsupported"
  };
}

function capabilityExamples(
  id: string,
  domain: string,
  canonical: string,
  overrides: string[] = []
): AgentCapabilityExample[] {
  const base = overrides[0] ?? canonical;
  const paraphrase = overrides[1] ?? `${base} 알려줘`;
  return [
    { kind: "canonical", utterance: base },
    { kind: "paraphrase", utterance: paraphrase },
    { kind: "typo", utterance: base.replaceAll(" ", "") },
    { kind: "honorific", utterance: `${base} 부탁드려요` },
    { kind: "abbreviation", utterance: `${domain} ${id.split(".").at(-1)} 요청` }
  ];
}

function selectorKindsFor(id: string): string[] {
  if (id.includes("meeting.control") || id.includes("meeting.recording")) {
    return ["current_meeting", "meeting_room_name"];
  }
  if (id.includes("meeting.participants")) return ["meeting_scope"];
  if (id.includes("meeting.report")) return ["meeting_report"];
  if (id.includes("meeting.action_items")) return ["action_item", "workspace_member"];
  if (id.includes("meeting.evidence")) return ["meeting_report", "query"];
  if (id.includes("calendar.events")) return ["calendar_event", "date_range"];
  if (id.includes("board.issues")) return ["board_issue"];
  if (id === "board.briefing") return ["board_context"];
  if (id.startsWith("sql_erd.")) return ["sql_erd_session", "table_reference"];
  if (id.startsWith("canvas.")) return ["canvas_context"];
  if (id.startsWith("pr_review.")) return ["pr_review_session"];
  if (id.startsWith("drive.")) return ["document_query"];
  return ["none"];
}

function hashCanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

export function validateAgentToolCapabilityCatalog(
  capabilities: AgentCapabilityDefinition[],
  descriptors: AgentToolCapabilityDescriptor[],
  definitions: AgentToolDefinition<unknown>[]
): void {
  const registeredToolNames = new Set(definitions.map((definition) => definition.name));
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  if (capabilityIds.size !== capabilities.length) {
    throw new Error("Agent capability catalog contains duplicate capability IDs");
  }
  for (const capability of capabilities) {
    for (const toolName of capability.toolNames) {
      if (TOOL_DOMAIN_BY_NAME[toolName] !== capability.domain) {
        throw new Error(
          `Agent capability domain mismatch: ${capability.id} includes ${toolName}`
        );
      }
    }
  }
  const capabilityById = new Map(
    capabilities.map((capability) => [capability.id, capability])
  );
  for (const descriptor of descriptors) {
    if (TOOL_DOMAIN_BY_NAME[descriptor.toolName] !== descriptor.domain) {
      throw new Error(
        `Agent tool descriptor domain mismatch: ${descriptor.toolName}`
      );
    }
    for (const capabilityId of descriptor.capabilityIds) {
      const capability = capabilityById.get(capabilityId);
      if (
        !capability ||
        capability.domain !== descriptor.domain ||
        !capability.toolNames.includes(descriptor.toolName)
      ) {
        throw new Error(
          `Agent capability descriptor domain mismatch: ${capabilityId} and ${descriptor.toolName}`
        );
      }
    }
  }
  if (
    capabilities.some(
      (capability) =>
        (capability.availability === "supported" && !capability.toolNames.length) ||
        (capability.availability === "unsupported" && capability.toolNames.length > 0) ||
        new Set(capability.toolNames).size !== capability.toolNames.length ||
        !capability.whenToUse ||
        !capability.mustNotUseFor.length ||
        !capability.positiveExamples.length ||
        !capability.selectorKinds.length ||
        capability.examples.length !== 5 ||
        new Set(capability.examples.map((example) => example.kind)).size !== 5 ||
        capability.examples.some((example) => !example.utterance.trim()) ||
        capability.toolNames.some((toolName) => !registeredToolNames.has(toolName)) ||
        (capability.availability === "supported" &&
          capability.requiresConfirmation !==
            (definitions.find(
              (definition) => definition.name === capability.toolNames.at(-1)
            )?.executionMode === "confirmation_required"))
    )
  ) {
    throw new Error("Agent capability catalog contains an invalid capability");
  }
  if (
    descriptors.length !== definitions.length ||
    descriptors.some(
      (descriptor) =>
        !registeredToolNames.has(descriptor.toolName) ||
        (descriptor.operation !== "read" && descriptor.operation !== "write") ||
        !descriptor.capabilityIds.length ||
        !descriptor.whenToUse ||
        !descriptor.mustNotUseFor.length ||
        !descriptor.selectorKinds.length ||
        !descriptor.inputSchemaSha256 ||
        descriptor.requiresConfirmation !==
          (descriptor.executionMode === "confirmation_required") ||
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
