import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

const SQL_ERD_TOOL_NAMES = new Set([
  "inspect_sql_erd_schema",
  "focus_sql_erd_tables"
]);
const LATENCY_STAGES = new Set([
  "tool_preparation",
  "tool_execution",
  "tool_advance",
  "tool_turn"
]);
const LATENCY_OUTCOMES = new Set([
  "success",
  "failure",
  "fallback",
  "clarification"
]);
const FAILURE_TYPES = new Set([
  "timeout",
  "validation_error",
  "repository_error",
  "domain_error",
  "unknown"
]);

export interface AgentLatencyObservationInput {
  runId: string;
  stage: string;
  outcome: string;
  surface: string | null | undefined;
  toolName: string;
  startedAt?: number;
  elapsedMs?: number;
  turnSequence?: number;
  failureType?: string;
}

export interface AgentLatencyEvent {
  event: "agent_latency";
  component: "app_server";
  stage: string;
  outcome: string;
  elapsed_ms: number;
  trace_key: string;
  turn_sequence?: number;
  surface: "sql_erd";
  tool_name: string;
  failure_type?: string;
}

export function agentLatencyTraceKey(runId: string): string {
  return createHash("sha256").update(runId, "utf8").digest("hex").slice(0, 16);
}

export function buildAgentLatencyEvent(
  input: AgentLatencyObservationInput
): AgentLatencyEvent | null {
  if (
    input.surface !== "sql_erd" ||
    !SQL_ERD_TOOL_NAMES.has(input.toolName) ||
    !LATENCY_STAGES.has(input.stage)
  ) {
    return null;
  }
  const measuredElapsed =
    input.elapsedMs ??
    (typeof input.startedAt === "number" ? performance.now() - input.startedAt : NaN);
  if (!Number.isFinite(measuredElapsed)) {
    return null;
  }

  const event: AgentLatencyEvent = {
    event: "agent_latency",
    component: "app_server",
    stage: input.stage,
    outcome: LATENCY_OUTCOMES.has(input.outcome) ? input.outcome : "failure",
    elapsed_ms: Math.max(0, Math.round(measuredElapsed)),
    trace_key: agentLatencyTraceKey(input.runId),
    surface: "sql_erd",
    tool_name: input.toolName
  };
  if (
    typeof input.turnSequence === "number" &&
    Number.isSafeInteger(input.turnSequence) &&
    input.turnSequence > 0
  ) {
    event.turn_sequence = input.turnSequence;
  }
  if (input.failureType !== undefined) {
    event.failure_type = FAILURE_TYPES.has(input.failureType)
      ? input.failureType
      : "unknown";
  }
  return event;
}

@Injectable()
export class AgentLatencyObserver {
  private readonly logger = new Logger(AgentLatencyObserver.name);

  start(): number {
    return performance.now();
  }

  observe(input: AgentLatencyObservationInput): void {
    try {
      const event = buildAgentLatencyEvent(input);
      if (event) {
        this.logger.log(JSON.stringify(event));
      }
    } catch {
      return;
    }
  }
}
