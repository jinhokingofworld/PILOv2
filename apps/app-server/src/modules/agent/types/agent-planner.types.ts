import type {
  AgentRiskLevel,
  AgentToolExecutionMode,
  AgentToolInputSummary
} from "./agent-tool.types";

export type AgentPlannerStatus =
  | "tool_candidate"
  | "needs_clarification"
  | "unsupported";

export type AgentPlannerIntent =
  | "calendar.list_events"
  | "calendar.create_event"
  | "calendar.update_event"
  | "meeting_report.list"
  | "meeting_report.summarize"
  | "board.search_issues"
  | "board.move_issue_status"
  | "board.get_issue_context"
  | "board.create_issue"
  | "board.resolve_context"
  | "board.get_briefing"
  | "board.assign_issue"
  | "board.diagnose_freshness"
  | "unsupported";

export type AgentPlannerToolName =
  | "list_calendar_events"
  | "create_calendar_event"
  | "update_calendar_event"
  | "list_meeting_reports"
  | "summarize_meeting_report"
  | "search_board_issues"
  | "move_board_issue_status"
  | "get_board_issue_context"
  | "create_board_issue"
  | "resolve_board_context"
  | "get_board_briefing"
  | "assign_board_issue_safely"
  | "diagnose_board_freshness";

export type AgentPlannerMissingField =
  | "calendar_event_title"
  | "calendar_event_time"
  | "calendar_event_target"
  | "board_issue"
  | "board_column"
  | "board_issue_title"
  | "board_assignee";

export type AgentPlannerUnsupportedReason =
  | "high_risk_or_excluded"
  | "unknown_intent";

export interface AgentPlannerInput {
  prompt: string;
  timezone: string;
}

export interface AgentPlannerToolCandidate {
  toolName: AgentPlannerToolName;
  riskLevel: AgentRiskLevel;
  executionMode: AgentToolExecutionMode;
  requiresConfirmation: boolean | null;
  inputSummary: AgentToolInputSummary;
  toolInputValidation: "tool_adapter_required";
}

export interface AgentPlannerResult {
  status: AgentPlannerStatus;
  intent: AgentPlannerIntent;
  message: string;
  toolCandidate?: AgentPlannerToolCandidate;
  missingFields?: AgentPlannerMissingField[];
  unsupportedReason?: AgentPlannerUnsupportedReason;
}
