import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  agentMessageRoutingDisabled,
  agentMessageRoutingStale,
  agentMessageRoutingUnavailable,
  clientRequestIdConflict
} from "./agent-api-error";
import {
  AgentInputRelationshipService,
  AgentInputRelationshipUnavailableError,
  type AgentInputRelationship,
  type AgentInputRelationshipContext,
  type AgentInputRelationshipDecision
} from "./agent-input-relationship.service";
import { AgentLoggingService } from "./agent-logging.service";
import { AgentOutboxPublisherService } from "./agent-outbox-publisher.service";
import {
  AgentService,
  type AgentRunDetailItemPayload,
  type AgentRunInput
} from "./agent.service";
import type { AgentRunRequestContext } from "./types/agent-tool.types";

const DEFAULT_TIMEZONE = "Asia/Seoul";
const MAX_MESSAGE_BYTES = 4000;
const MAX_CLIENT_REQUEST_ID_BYTES = 128;
const BUDGET_EXHAUSTION_MESSAGE_MARKERS = [
  "한 요청에서 실행할 수 있는 작업은 최대",
  "한 요청에서 계획할 수 있는 작업은 최대"
] as const;
const EXPLICIT_CONTINUATION_PATTERN =
  /(계속(?:해|해서|\s*진행)|이어서|이어\s*서|마저|남은\s*(?:내용|작업)|나머지|하던\s*(?:작업|요청)|다음\s*(?:단계|작업))/;
const EXPLICIT_CANCELLATION_PATTERN =
  /(취소|그만|중단|멈춰|필요\s*없|하지\s*마|됐어|됐습니다)/;
const ACTIONABLE_REQUEST_PATTERN =
  /(알려|보여|조회|찾|만들|추가|생성|변경|바꾸|바꿔|수정|옮기|이동|삭제|지우|요약|승인|반려|실행|시작|종료|열어|작성|보내|뭐야|뭔지|무엇|언제|어디|누구|몇)/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ROUTING_OUTCOMES = [
  "continued",
  "started_new",
  "needs_choice",
  "cancelled"
] as const;

type AgentMessageOutcome = (typeof ROUTING_OUTCOMES)[number];
type AgentMessageDisposition = "auto" | "continue_previous" | "start_new";

interface AgentMessageInput {
  message: string;
  conversationId?: string | null;
  timezone: string;
  clientRequestId: string;
  activeRunId: string | null;
  requestContext: AgentRunRequestContext;
  disposition: AgentMessageDisposition;
  runInput: AgentRunInput;
}

interface ActiveRunSnapshot extends QueryResultRow {
  id: string;
  thread_id: string | null;
  status: "waiting_user_input" | "waiting_confirmation";
  prompt: string;
  timezone: string;
  request_context_json: AgentRunRequestContext;
  message: string | null;
  expires_at: Date | string;
  updated_at: Date | string;
  pending_confirmation_id: string | null;
  confirmation_expires_at: Date | string | null;
  candidate_state: string;
}

interface MessageRouteReplayRow extends QueryResultRow {
  run_id: string;
  request_fingerprint: string;
  outcome: string;
  relationship: string;
  previous_run_id: string | null;
  clarification_question: string | null;
  active_run_was_null: string | null;
  resolved_active_run_id: string | null;
}

interface TransactionOutcome {
  outcome: AgentMessageOutcome;
  relationship: AgentInputRelationship;
  runId: string | null;
  previousRunId: string | null;
  clarificationQuestion: string | null;
  publishRunId: string | null;
}

export interface AgentMessagePayload {
  outcome: AgentMessageOutcome;
  relationship: AgentInputRelationship;
  run: AgentRunDetailItemPayload | null;
  previousRun: AgentRunDetailItemPayload | null;
  clarification:
    | {
        question: string;
        choices: Array<{
          disposition: "continue_previous" | "start_new";
          label: string;
        }>;
      }
    | null;
}

@Injectable()
export class AgentMessageService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentService: AgentService,
    private readonly agentLoggingService: AgentLoggingService,
    private readonly relationshipService: AgentInputRelationshipService,
    private readonly outboxPublisherService: AgentOutboxPublisherService
  ) {}

  async routeMessage(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<AgentMessagePayload> {
    if (this.routingMode() !== "intent") {
      throw agentMessageRoutingDisabled(
        "Agent message intent routing is disabled"
      );
    }

    const input = this.normalizeInput(body);
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const earlyReplay = await this.findRouteReplay(
      this.database,
      workspaceId,
      currentUserId,
      input.clientRequestId
    );
    if (earlyReplay) {
      if (!this.isMatchingReplayRequest(earlyReplay, input)) {
        throw clientRequestIdConflict(
          "clientRequestId was already used for a different Agent message"
        );
      }
      if (
        earlyReplay.outcome !== "needs_choice" ||
        input.disposition === "auto"
      ) {
        return this.materializeOutcome(
          currentUserId,
          workspaceId,
          this.mapReplay(earlyReplay)
        );
      }
    }

    await this.agentService.assertRequestContextAccess(
      workspaceId,
      input.requestContext
    );

    let snapshot: ActiveRunSnapshot | null = null;
    let decision: AgentInputRelationshipDecision = {
      relationship: "new_intent",
      confidence: "high",
      reason: "대기 중인 Run이 없는 일반 신규 요청입니다.",
      clarificationQuestion: null
    };

    if (input.activeRunId) {
      snapshot = await this.loadActiveRunSnapshot(
        currentUserId,
        workspaceId,
        input.activeRunId
      );
      if (
        input.conversationId === null ||
        (input.conversationId && input.conversationId !== snapshot.thread_id)
      ) {
        throw agentMessageRoutingStale(
          "Agent run does not belong to the active conversation"
        );
      }
      this.assertSnapshotCanReceiveMessage(snapshot);
    } else if (input.conversationId !== null) {
      snapshot = await this.loadLatestWaitingRunSnapshot(
        currentUserId,
        workspaceId,
        input.conversationId
      );
    }
    if (snapshot) {
      decision = await this.decideRelationship(
        currentUserId,
        workspaceId,
        snapshot,
        input
      );
    }

    const transactionOutcome = await this.database.transaction((transaction) =>
      this.applyDecisionInTransaction(
        transaction,
        currentUserId,
        workspaceId,
        input,
        snapshot,
        decision
      )
    );

    if (transactionOutcome.publishRunId) {
      await this.outboxPublisherService.publishCreatedRun(
        transactionOutcome.publishRunId
      );
    }

    return this.materializeOutcome(currentUserId, workspaceId, transactionOutcome);
  }

  private async materializeOutcome(
    currentUserId: string,
    workspaceId: string,
    transactionOutcome: TransactionOutcome
  ): Promise<AgentMessagePayload> {
    const [run, previousRun] = await Promise.all([
      transactionOutcome.runId
        ? this.agentService
            .getRun(currentUserId, workspaceId, transactionOutcome.runId)
            .then((payload) => payload.run)
        : Promise.resolve(null),
      transactionOutcome.previousRunId
        ? this.agentService
            .getRun(currentUserId, workspaceId, transactionOutcome.previousRunId)
            .then((payload) => payload.run)
        : Promise.resolve(null)
    ]);

    return {
      outcome: transactionOutcome.outcome,
      relationship: transactionOutcome.relationship,
      run,
      previousRun,
      clarification: transactionOutcome.clarificationQuestion
        ? {
            question: transactionOutcome.clarificationQuestion,
            choices: [
              {
                disposition: "continue_previous",
                label: "기존 작업 계속"
              },
              {
                disposition: "start_new",
                label: "새 요청 시작"
              }
            ]
          }
        : null
    };
  }

  private async decideRelationship(
    currentUserId: string,
    workspaceId: string,
    snapshot: ActiveRunSnapshot,
    input: AgentMessageInput
  ): Promise<AgentInputRelationshipDecision> {
    if (input.disposition === "continue_previous") {
      return {
        relationship: "continuation",
        confidence: "high",
        reason: "사용자가 기존 작업 계속을 명시했습니다.",
        clarificationQuestion: null
      };
    }
    if (input.disposition === "start_new") {
      return {
        relationship: "new_intent",
        confidence: "high",
        reason: "사용자가 새 요청 시작을 명시했습니다.",
        clarificationQuestion: null
      };
    }

    const deterministicContinuation = await this.database.transaction(
      (transaction) =>
        this.agentService.isDeterministicCandidateContinuationInTransaction(
          transaction,
          currentUserId,
          workspaceId,
          snapshot.id,
          snapshot.request_context_json,
          input.runInput
        )
    );
    if (deterministicContinuation) {
      return {
        relationship: "continuation",
        confidence: "high",
        reason: "서버가 검증한 후보 선택 입력입니다.",
        clarificationQuestion: null
      };
    }

    const budgetExhaustionDecision = this.decideBudgetExhaustionRelationship(
      snapshot,
      input.message
    );
    if (budgetExhaustionDecision) {
      return budgetExhaustionDecision;
    }

    try {
      const decision = await this.relationshipService.classify(
        await this.buildRelationshipContext(
          currentUserId,
          workspaceId,
          snapshot,
          input
        )
      );
      return this.applyConfidencePolicy(snapshot, decision);
    } catch (error) {
      if (error instanceof AgentInputRelationshipUnavailableError) {
        throw agentMessageRoutingUnavailable(
          "Agent message intent routing is unavailable"
        );
      }
      throw error;
    }
  }

  private async applyDecisionInTransaction(
    transaction: DatabaseTransaction,
    currentUserId: string,
    workspaceId: string,
    input: AgentMessageInput,
    snapshot: ActiveRunSnapshot | null,
    decision: AgentInputRelationshipDecision
  ): Promise<TransactionOutcome> {
    await transaction.execute(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      [`agent-message:${workspaceId}:${currentUserId}:${input.clientRequestId}`]
    );
    const fingerprint = this.requestFingerprint(input);
    const replay = await this.findRouteReplay(
      transaction,
      workspaceId,
      currentUserId,
      input.clientRequestId
    );
    if (replay) {
      if (!this.isMatchingReplayRequest(replay, input)) {
        throw clientRequestIdConflict(
          "clientRequestId was already used for a different Agent message"
        );
      }
      if (
        replay.outcome !== "needs_choice" ||
        input.disposition === "auto"
      ) {
        return this.mapReplay(replay);
      }
    }

    if (!snapshot) {
      const created = await this.agentLoggingService.createRunInTransaction(
        transaction,
        currentUserId,
        workspaceId,
        {
          prompt: input.message,
          ...(input.conversationId === undefined
            ? {}
            : { conversationId: input.conversationId }),
          timezone: input.timezone,
          clientRequestId: input.clientRequestId,
          requestContext: input.requestContext
        }
      );
      await this.insertRouteLog(transaction, workspaceId, created.run.id, {
        currentUserId,
        clientRequestId: input.clientRequestId,
        fingerprint,
        outcome: "started_new",
        relationship: "new_intent",
        confidence: decision.confidence,
        activeRunId: input.activeRunId,
        resolvedActiveRunId: null,
        previousRunId: null,
        clarificationQuestion: null
      });
      return {
        outcome: "started_new",
        relationship: "new_intent",
        runId: created.run.id,
        previousRunId: null,
        clarificationQuestion: null,
        publishRunId: created.created ? created.run.id : null
      };
    }

    const lockedRun = await this.lockCurrentRunAndConfirmation(
      transaction,
      currentUserId,
      workspaceId,
      snapshot.id
    );
    this.assertSnapshotStillCurrent(snapshot, lockedRun);

    if (decision.relationship === "continuation") {
      if (lockedRun.status === "waiting_confirmation") {
        if (input.disposition !== "continue_previous") {
          throw agentMessageRoutingStale(
            "Confirmation input must use the confirmation endpoint"
          );
        }
      } else {
        const outcome = await this.agentService.resumeRunInputInTransaction(
          transaction,
          currentUserId,
          workspaceId,
          lockedRun.id,
          input.runInput
        );
        if (outcome === "expired") {
          throw agentMessageRoutingStale("Agent run input wait has expired");
        }
      }
      await this.insertRouteLog(transaction, workspaceId, lockedRun.id, {
        currentUserId,
        clientRequestId: input.clientRequestId,
        fingerprint,
        outcome: "continued",
        relationship: "continuation",
        confidence: decision.confidence,
        activeRunId: input.activeRunId,
        resolvedActiveRunId: lockedRun.id,
        previousRunId: null,
        clarificationQuestion: null
      });
      return {
        outcome: "continued",
        relationship: "continuation",
        runId: lockedRun.id,
        previousRunId: null,
        clarificationQuestion: null,
        publishRunId:
          lockedRun.status === "waiting_user_input" ? lockedRun.id : null
      };
    }

    if (decision.relationship === "ambiguous") {
      const clarificationQuestion =
        decision.clarificationQuestion ??
        "기존 작업을 이어갈까요, 아니면 새 요청을 시작할까요?";
      await this.insertRouteLog(transaction, workspaceId, lockedRun.id, {
        currentUserId,
        clientRequestId: input.clientRequestId,
        fingerprint,
        outcome: "needs_choice",
        relationship: "ambiguous",
        confidence: decision.confidence,
        activeRunId: input.activeRunId,
        resolvedActiveRunId: lockedRun.id,
        previousRunId: null,
        clarificationQuestion
      });
      return {
        outcome: "needs_choice",
        relationship: "ambiguous",
        runId: lockedRun.id,
        previousRunId: null,
        clarificationQuestion,
        publishRunId: null
      };
    }

    if (decision.relationship === "cancel") {
      await this.cancelRunInTransaction(
        transaction,
        currentUserId,
        workspaceId,
        lockedRun.id,
        "cancelled_by_user",
        null,
        "사용자가 요청을 취소했습니다."
      );
      await this.insertRouteLog(transaction, workspaceId, lockedRun.id, {
        currentUserId,
        clientRequestId: input.clientRequestId,
        fingerprint,
        outcome: "cancelled",
        relationship: "cancel",
        confidence: decision.confidence,
        activeRunId: input.activeRunId,
        resolvedActiveRunId: lockedRun.id,
        previousRunId: null,
        clarificationQuestion: null
      });
      return {
        outcome: "cancelled",
        relationship: "cancel",
        runId: lockedRun.id,
        previousRunId: null,
        clarificationQuestion: null,
        publishRunId: null
      };
    }

    if (!lockedRun.thread_id) {
      throw agentMessageRoutingStale("Agent run thread is unavailable");
    }
    if (lockedRun.status === "waiting_user_input") {
      await this.cancelRunStateInTransaction(
        transaction,
        lockedRun.id,
        currentUserId,
        "새 요청이 시작되어 이전 요청을 종료했습니다."
      );
    }
    const replacement = await this.agentLoggingService.createRunInTransaction(
      transaction,
      currentUserId,
      workspaceId,
      {
        prompt: input.message,
        timezone: input.timezone,
        clientRequestId: input.clientRequestId,
        requestContext: input.requestContext
      },
      lockedRun.thread_id
    );
    if (lockedRun.status === "waiting_user_input") {
      await this.insertCancellationLog(
        transaction,
        currentUserId,
        workspaceId,
        lockedRun.id,
        "superseded_by_new_intent",
        replacement.run.id
      );
    }
    await this.insertRouteLog(transaction, workspaceId, replacement.run.id, {
      currentUserId,
      clientRequestId: input.clientRequestId,
      fingerprint,
      outcome: "started_new",
      relationship: "new_intent",
      confidence: decision.confidence,
      activeRunId: input.activeRunId,
      resolvedActiveRunId: lockedRun.id,
      previousRunId: lockedRun.id,
      clarificationQuestion: null
    });
    return {
      outcome: "started_new",
      relationship: "new_intent",
      runId: replacement.run.id,
      previousRunId: lockedRun.id,
      clarificationQuestion: null,
      publishRunId: replacement.created ? replacement.run.id : null
    };
  }

  private async lockCurrentRunAndConfirmation(
    transaction: DatabaseTransaction,
    currentUserId: string,
    workspaceId: string,
    runId: string
  ): Promise<ActiveRunSnapshot> {
    const run = await transaction.queryOne<ActiveRunSnapshot>(
      `
        SELECT
          run.id,
          run.thread_id,
          run.status,
          run.prompt,
          run.timezone,
          run.request_context_json,
          run.message,
          run.expires_at,
          run.updated_at,
          pending_confirmation.id AS pending_confirmation_id,
          pending_confirmation.expires_at AS confirmation_expires_at
        FROM agent_runs AS run
        LEFT JOIN LATERAL (
          SELECT confirmation.id, confirmation.expires_at
          FROM agent_confirmations AS confirmation
          WHERE confirmation.run_id = run.id
            AND confirmation.status = 'pending'
          ORDER BY confirmation.created_at DESC
          LIMIT 1
        ) AS pending_confirmation ON true
        WHERE run.id = $1
          AND run.workspace_id = $2
          AND run.requested_by_user_id = $3
        FOR UPDATE OF run
      `,
      [runId, workspaceId, currentUserId]
    );
    if (!run) throw notFound("Agent run not found");
    if (run.pending_confirmation_id) {
      const confirmation = await transaction.queryOne<{
        id: string;
        expires_at: Date | string;
      }>(
        `
          SELECT id, expires_at
          FROM agent_confirmations
          WHERE id = $1
            AND run_id = $2
            AND status = 'pending'
          FOR UPDATE
        `,
        [run.pending_confirmation_id, run.id]
      );
      run.pending_confirmation_id = confirmation?.id ?? null;
      run.confirmation_expires_at = confirmation?.expires_at ?? null;
    }
    run.candidate_state = await this.loadCandidateState(
      transaction,
      currentUserId,
      workspaceId,
      run.id
    );
    return run;
  }

  private async cancelRunInTransaction(
    transaction: DatabaseTransaction,
    currentUserId: string,
    workspaceId: string,
    runId: string,
    reason: "cancelled_by_user",
    replacementRunId: null,
    message: string
  ): Promise<void> {
    await this.cancelRunStateInTransaction(
      transaction,
      runId,
      currentUserId,
      message
    );
    await this.insertCancellationLog(
      transaction,
      currentUserId,
      workspaceId,
      runId,
      reason,
      replacementRunId
    );
  }

  private async cancelRunStateInTransaction(
    transaction: DatabaseTransaction,
    runId: string,
    currentUserId: string,
    message: string
  ): Promise<void> {
    await transaction.execute(
      `
        UPDATE agent_confirmations
        SET status = 'rejected',
            rejected_by_user_id = $2,
            rejected_at = now()
        WHERE run_id = $1
          AND status = 'pending'
      `,
      [runId, currentUserId]
    );
    await transaction.execute(
      `
        UPDATE agent_candidate_selections
        SET consumed_at = now()
        WHERE run_id = $1
          AND consumed_at IS NULL
      `,
      [runId]
    );
    await transaction.execute(
      `
        UPDATE agent_steps
        SET status = 'skipped',
            completed_at = now(),
            updated_at = now()
        WHERE run_id = $1
          AND status IN ('pending', 'running')
      `,
      [runId]
    );
    await transaction.execute(
      `
        UPDATE agent_run_outbox
        SET status = 'failed',
            claim_token = NULL,
            claimed_at = NULL,
            error_code = NULL,
            error_message = NULL
        WHERE run_id = $1
      `,
      [runId]
    );
    await transaction.execute(
      `
        INSERT INTO agent_run_messages (run_id, sequence, role, content)
        SELECT $1, COALESCE(MAX(sequence), 0) + 1, 'assistant', $2
        FROM agent_run_messages
        WHERE run_id = $1
      `,
      [runId, message]
    );
    const cancelled = await transaction.queryOne<{ id: string }>(
      `
        UPDATE agent_runs
        SET status = 'cancelled',
            message = $2,
            final_answer = NULL,
            error_code = NULL,
            error_message = NULL,
            completed_at = now(),
            execution_lease_token = NULL,
            execution_lease_expires_at = NULL,
            execution_heartbeat_at = NULL,
            updated_at = now()
        WHERE id = $1
          AND status IN ('waiting_user_input', 'waiting_confirmation')
        RETURNING id
      `,
      [runId, message]
    );
    if (!cancelled) {
      throw agentMessageRoutingStale("Agent run changed while routing the message");
    }
  }

  private async insertCancellationLog(
    transaction: DatabaseTransaction,
    currentUserId: string,
    workspaceId: string,
    runId: string,
    reason: "cancelled_by_user" | "superseded_by_new_intent",
    replacementRunId: string | null
  ): Promise<void> {
    await transaction.execute(
      `
        INSERT INTO agent_logs (
          workspace_id,
          run_id,
          actor_type,
          actor_user_id,
          level,
          event_type,
          message,
          metadata_json,
          resource_refs
        ) VALUES (
          $1, $2, 'user', $3, 'info', 'run_cancelled',
          'Agent run cancelled',
          jsonb_build_object('reason', $4::text, 'replacementRunId', $5::text),
          '[]'::jsonb
        )
      `,
      [workspaceId, runId, currentUserId, reason, replacementRunId]
    );
  }

  private async insertRouteLog(
    transaction: DatabaseTransaction,
    workspaceId: string,
    runId: string,
    input: {
      currentUserId: string;
      clientRequestId: string;
      fingerprint: string;
      outcome: AgentMessageOutcome;
      relationship: AgentInputRelationship;
      confidence: AgentInputRelationshipDecision["confidence"];
      activeRunId: string | null;
      resolvedActiveRunId: string | null;
      previousRunId: string | null;
      clarificationQuestion: string | null;
    }
  ): Promise<void> {
    await transaction.execute(
      `
        INSERT INTO agent_logs (
          workspace_id,
          run_id,
          actor_type,
          actor_user_id,
          level,
          event_type,
          message,
          metadata_json,
          resource_refs
        ) VALUES (
          $1, $2, 'app_server', $3, 'info', 'message_routed',
          'Agent message routed',
          jsonb_build_object(
            'clientRequestId', $4::text,
            'requestFingerprint', $5::text,
            'outcome', $6::text,
            'relationship', $7::text,
            'confidence', $8::text,
            'activeRunWasNull', $9::boolean,
            'resolvedActiveRunId', $10::text,
            'previousRunId', $11::text,
            'clarificationQuestion', $12::text
          ),
          '[]'::jsonb
        )
      `,
      [
        workspaceId,
        runId,
        input.currentUserId,
        input.clientRequestId,
        input.fingerprint,
        input.outcome,
        input.relationship,
        input.confidence,
        input.activeRunId === null,
        input.resolvedActiveRunId,
        input.previousRunId,
        input.clarificationQuestion
      ]
    );
  }

  private async findRouteReplay(
    transaction: Pick<DatabaseTransaction, "queryOne">,
    workspaceId: string,
    currentUserId: string,
    clientRequestId: string
  ): Promise<MessageRouteReplayRow | null> {
    return transaction.queryOne<MessageRouteReplayRow>(
      `
        SELECT
          log.run_id,
          log.metadata_json->>'requestFingerprint' AS request_fingerprint,
          log.metadata_json->>'outcome' AS outcome,
          log.metadata_json->>'relationship' AS relationship,
          log.metadata_json->>'previousRunId' AS previous_run_id,
          log.metadata_json->>'clarificationQuestion' AS clarification_question,
          log.metadata_json->>'activeRunWasNull' AS active_run_was_null,
          log.metadata_json->>'resolvedActiveRunId' AS resolved_active_run_id
        FROM agent_logs AS log
        JOIN agent_runs AS run
          ON run.id = log.run_id
         AND run.workspace_id = log.workspace_id
        WHERE log.workspace_id = $1
          AND run.requested_by_user_id = $2
          AND log.event_type = 'message_routed'
          AND log.metadata_json->>'clientRequestId' = $3
        ORDER BY log.created_at DESC, log.run_id DESC
        LIMIT 1
      `,
      [workspaceId, currentUserId, clientRequestId]
    );
  }

  private mapReplay(replay: MessageRouteReplayRow): TransactionOutcome {
    if (
      !ROUTING_OUTCOMES.includes(replay.outcome as AgentMessageOutcome) ||
      !["continuation", "new_intent", "cancel", "ambiguous"].includes(
        replay.relationship
      )
    ) {
      throw agentMessageRoutingStale("Agent message routing replay is invalid");
    }
    return {
      outcome: replay.outcome as AgentMessageOutcome,
      relationship: replay.relationship as AgentInputRelationship,
      runId: replay.run_id,
      previousRunId: replay.previous_run_id,
      clarificationQuestion: replay.clarification_question,
      publishRunId: null
    };
  }

  private isMatchingReplayRequest(
    replay: MessageRouteReplayRow,
    input: AgentMessageInput
  ): boolean {
    if (replay.request_fingerprint === this.requestFingerprint(input)) {
      return true;
    }
    if (
      replay.outcome !== "needs_choice" ||
      replay.active_run_was_null !== "true" ||
      !input.activeRunId ||
      replay.resolved_active_run_id !== input.activeRunId
    ) {
      return false;
    }
    return (
      replay.request_fingerprint ===
      this.requestFingerprint({ ...input, activeRunId: null })
    );
  }

  private async loadActiveRunSnapshot(
    currentUserId: string,
    workspaceId: string,
    runId: string
  ): Promise<ActiveRunSnapshot> {
    const run = await this.database.queryOne<ActiveRunSnapshot>(
      `
        SELECT
          run.id,
          run.thread_id,
          run.status,
          run.prompt,
          run.timezone,
          run.request_context_json,
          run.message,
          run.expires_at,
          run.updated_at,
          confirmation.id AS pending_confirmation_id,
          confirmation.expires_at AS confirmation_expires_at
        FROM agent_runs AS run
        LEFT JOIN LATERAL (
          SELECT id, expires_at
          FROM agent_confirmations
          WHERE run_id = run.id
            AND status = 'pending'
          ORDER BY created_at DESC
          LIMIT 1
        ) AS confirmation ON true
        WHERE run.id = $1
          AND run.workspace_id = $2
          AND run.requested_by_user_id = $3
      `,
      [runId, workspaceId, currentUserId]
    );
    if (!run) throw notFound("Agent run not found");
    run.candidate_state = await this.loadCandidateState(
      this.database,
      currentUserId,
      workspaceId,
      run.id
    );
    return run;
  }

  private async loadLatestWaitingRunSnapshot(
    currentUserId: string,
    workspaceId: string,
    conversationId?: string
  ): Promise<ActiveRunSnapshot | null> {
    const run = await this.database.queryOne<ActiveRunSnapshot>(
      `
        SELECT
          run.id,
          run.thread_id,
          run.status,
          run.prompt,
          run.timezone,
          run.request_context_json,
          run.message,
          run.expires_at,
          run.updated_at,
          confirmation.id AS pending_confirmation_id,
          confirmation.expires_at AS confirmation_expires_at
        FROM agent_runs AS run
        LEFT JOIN LATERAL (
          SELECT id, expires_at
          FROM agent_confirmations
          WHERE run_id = run.id
            AND status = 'pending'
            AND expires_at > now()
          ORDER BY created_at DESC
          LIMIT 1
        ) AS confirmation ON true
        WHERE run.workspace_id = $1
          AND run.requested_by_user_id = $2
          AND ($3::uuid IS NULL OR run.thread_id = $3)
          AND run.expires_at > now()
          AND (
            (
              run.status = 'waiting_user_input'
              AND run.updated_at > now() - INTERVAL '24 hours'
            )
            OR (
              run.status = 'waiting_confirmation'
              AND confirmation.id IS NOT NULL
            )
          )
        ORDER BY run.updated_at DESC, run.created_at DESC, run.id DESC
        LIMIT 1
      `,
      [workspaceId, currentUserId, conversationId ?? null]
    );
    if (!run) return null;
    run.candidate_state = await this.loadCandidateState(
      this.database,
      currentUserId,
      workspaceId,
      run.id
    );
    return run;
  }

  private async loadCandidateState(
    transaction: Pick<DatabaseTransaction, "queryOne">,
    currentUserId: string,
    workspaceId: string,
    runId: string
  ): Promise<string> {
    const state = await transaction.queryOne<{ candidate_state: string }>(
      `
        SELECT COALESCE(
          string_agg(candidate.id::text, ',' ORDER BY candidate.id),
          ''
        ) AS candidate_state
        FROM agent_candidate_selections AS candidate
        WHERE candidate.run_id = $1
          AND candidate.workspace_id = $2
          AND candidate.requested_by_user_id = $3
          AND candidate.consumed_at IS NULL
          AND candidate.expires_at > now()
      `,
      [runId, workspaceId, currentUserId]
    );
    return state?.candidate_state ?? "";
  }

  private applyConfidencePolicy(
    snapshot: ActiveRunSnapshot,
    decision: AgentInputRelationshipDecision
  ): AgentInputRelationshipDecision {
    if (
      snapshot.status === "waiting_confirmation" &&
      decision.relationship === "continuation"
    ) {
      return {
        relationship: "ambiguous",
        confidence: decision.confidence,
        reason: "일반 채팅 입력으로 confirmation을 승인할 수 없습니다.",
        clarificationQuestion:
          "기존 승인 대기를 유지할까요, 아니면 새 요청을 시작할까요?"
      };
    }
    const shouldAskForChoice =
      (decision.relationship === "continuation" &&
        decision.confidence === "low") ||
      (decision.relationship === "cancel" && decision.confidence !== "high");
    if (!shouldAskForChoice) return decision;
    return {
      relationship: "ambiguous",
      confidence: decision.confidence,
      reason: "낮은 분류 신뢰도로 기존 Run 상태를 변경하지 않습니다.",
      clarificationQuestion:
        "기존 작업을 이어갈까요, 아니면 새 요청을 시작할까요?"
    };
  }

  private decideBudgetExhaustionRelationship(
    snapshot: ActiveRunSnapshot,
    message: string
  ): AgentInputRelationshipDecision | null {
    if (
      snapshot.status !== "waiting_user_input" ||
      !this.isBudgetExhaustionMessage(snapshot.message)
    ) {
      return null;
    }
    if (EXPLICIT_CONTINUATION_PATTERN.test(message)) {
      return {
        relationship: "continuation",
        confidence: "high",
        reason: "사용자가 budget 소진 후 기존 작업 계속을 명시했습니다.",
        clarificationQuestion: null
      };
    }
    if (EXPLICIT_CANCELLATION_PATTERN.test(message)) {
      return null;
    }
    if (!ACTIONABLE_REQUEST_PATTERN.test(message)) {
      return null;
    }
    return {
      relationship: "new_intent",
      confidence: "high",
      reason: "budget 소진 대기 중 구체적인 새 작업 요청이 입력되었습니다.",
      clarificationQuestion: null
    };
  }

  private isBudgetExhaustionMessage(message: string | null): boolean {
    return Boolean(
      message &&
        BUDGET_EXHAUSTION_MESSAGE_MARKERS.some((marker) =>
          message.includes(marker)
        )
    );
  }

  private assertSnapshotCanReceiveMessage(snapshot: ActiveRunSnapshot): void {
    if (
      snapshot.status !== "waiting_user_input" &&
      snapshot.status !== "waiting_confirmation"
    ) {
      throw agentMessageRoutingStale("Agent run is not waiting for a message");
    }
    if (new Date(snapshot.expires_at).getTime() <= Date.now()) {
      throw agentMessageRoutingStale("Agent run has expired");
    }
    if (
      snapshot.status === "waiting_user_input" &&
      new Date(snapshot.updated_at).getTime() <= Date.now() - 24 * 60 * 60 * 1000
    ) {
      throw agentMessageRoutingStale("Agent run input wait has expired");
    }
    if (
      snapshot.status === "waiting_confirmation" &&
      (!snapshot.pending_confirmation_id ||
        !snapshot.confirmation_expires_at ||
        new Date(snapshot.confirmation_expires_at).getTime() <= Date.now())
    ) {
      throw agentMessageRoutingStale("Agent confirmation is not pending");
    }
  }

  private assertSnapshotStillCurrent(
    snapshot: ActiveRunSnapshot,
    lockedRun: ActiveRunSnapshot
  ): void {
    this.assertSnapshotCanReceiveMessage(lockedRun);
    if (
      snapshot.status !== lockedRun.status ||
      new Date(snapshot.updated_at).getTime() !==
        new Date(lockedRun.updated_at).getTime() ||
      snapshot.pending_confirmation_id !== lockedRun.pending_confirmation_id ||
      snapshot.candidate_state !== lockedRun.candidate_state
    ) {
      throw agentMessageRoutingStale(
        "Agent run changed while classifying the message"
      );
    }
  }

  private async buildRelationshipContext(
    currentUserId: string,
    workspaceId: string,
    snapshot: ActiveRunSnapshot,
    input: AgentMessageInput
  ): Promise<AgentInputRelationshipContext> {
    const [messages, candidates] = await Promise.all([
      this.database.query<{
        role: "user" | "assistant";
        content: string;
      }>(
        `
          SELECT role, content
          FROM (
            SELECT role, content, sequence
            FROM agent_run_messages
            WHERE run_id = $1
            ORDER BY sequence DESC
            LIMIT 8
          ) AS recent
          ORDER BY sequence ASC
        `,
        [snapshot.id]
      ),
      this.database.query<{ resource_type: string }>(
        `
          SELECT DISTINCT candidate.resource_type
          FROM agent_candidate_selections AS candidate
          WHERE candidate.run_id = $1
            AND candidate.workspace_id = $2
            AND candidate.requested_by_user_id = $3
            AND candidate.consumed_at IS NULL
            AND candidate.expires_at > now()
          ORDER BY candidate.resource_type ASC
          LIMIT 10
        `,
        [snapshot.id, workspaceId, currentUserId]
      )
    ]);
    const timeline = messages.map((message) => ({
      role: message.role,
      content: this.sanitizeProviderText(message.content, 500)
    }));
    const latestAssistantQuestion = [...timeline]
      .reverse()
      .find((message) => message.role === "assistant")?.content ?? null;
    return {
      originalGoal: this.sanitizeProviderText(snapshot.prompt, 1000),
      latestAssistantQuestion,
      waitingInputKind:
        snapshot.status === "waiting_confirmation"
          ? "confirmation"
          : candidates.length > 0
            ? "candidate"
            : this.isBudgetExhaustionMessage(
                  latestAssistantQuestion ?? snapshot.message
                )
              ? "budget_exhausted"
            : latestAssistantQuestion
              ? "clarification"
              : "other",
      timeline,
      newMessage: this.sanitizeProviderText(input.message, 1000),
      requestSurface: input.requestContext?.surface ?? null,
      hasCandidates: candidates.length > 0,
      candidateTypes: candidates.map((candidate) => candidate.resource_type),
      runStatus: snapshot.status
    };
  }

  private normalizeInput(body: unknown): AgentMessageInput {
    if (!this.isRecord(body)) throw badRequest("Request body must be an object");
    const allowedFields = new Set([
      "message",
      "conversationId",
      "timezone",
      "clientRequestId",
      "activeRunId",
      "requestContext",
      "disposition",
      "selection"
    ]);
    const unexpected = Object.keys(body).find((key) => !allowedFields.has(key));
    if (unexpected) throw badRequest(`${unexpected} must not be provided`);
    const message = this.requiredText(body.message, "message", MAX_MESSAGE_BYTES);
    const clientRequestId = this.requiredText(
      body.clientRequestId,
      "clientRequestId",
      MAX_CLIENT_REQUEST_ID_BYTES
    );
    if (!("activeRunId" in body)) {
      throw badRequest("activeRunId is required and may be null");
    }
    const activeRunId = this.optionalUuid(body.activeRunId, "activeRunId");
    const conversationId = this.optionalConversationUuid(
      body.conversationId,
      "conversationId"
    );
    const disposition = body.disposition ?? "auto";
    if (
      disposition !== "auto" &&
      disposition !== "continue_previous" &&
      disposition !== "start_new"
    ) {
      throw badRequest("disposition must be a valid Agent message disposition");
    }
    const normalizedRun = this.agentService.normalizeCreateRunBody({
      prompt: message,
      ...(conversationId === undefined ? {} : { conversationId }),
      timezone: body.timezone,
      clientRequestId,
      requestContext: body.requestContext
    });
    const runInput = this.agentService.normalizeRunInputBody({
      message,
      ...(body.selection === undefined ? {} : { selection: body.selection })
    });
    return {
      message,
      ...(conversationId === undefined ? {} : { conversationId }),
      timezone: normalizedRun.timezone ?? DEFAULT_TIMEZONE,
      clientRequestId,
      activeRunId,
      requestContext: normalizedRun.requestContext,
      disposition,
      runInput
    };
  }

  private requestFingerprint(input: AgentMessageInput): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          activeRunId: input.activeRunId,
          conversationId:
            input.conversationId === undefined
              ? "legacy"
              : input.conversationId,
          clientRequestId: input.clientRequestId,
          message: input.message,
          requestContext: input.requestContext,
          selection: input.runInput.selection ?? null,
          timezone: input.timezone
        }),
        "utf8"
      )
      .digest("hex");
  }

  private requiredText(value: unknown, field: string, maxBytes: number): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} is required`);
    }
    const normalized = value.trim();
    if (Buffer.byteLength(normalized, "utf8") > maxBytes) {
      throw badRequest(`${field} is too long`);
    }
    return normalized;
  }

  private optionalUuid(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw badRequest(`${field} must be a UUID or null`);
    }
    return value;
  }

  private optionalConversationUuid(
    value: unknown,
    field: string
  ): string | null | undefined {
    if (value === undefined) return undefined;
    return this.optionalUuid(value, field);
  }

  private truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  private sanitizeProviderText(value: string, maxLength: number): string {
    const sanitized = value
      .replace(
        /-----BEGIN [^-\r\n]+-----[\s\S]*?(?:-----END [^-\r\n]+-----|$)/gi,
        "[secret]"
      )
      .replace(UUID_IN_TEXT_PATTERN, "[resource]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[secret]")
      .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}\b/gi, "[secret]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [secret]")
      .replace(
        /\b(token|secret|api[_-]?key|authorization|credential)\s*[:=]\s*[^\s,;]+/gi,
        "$1=[secret]"
      );
    return this.truncate(sanitized, maxLength);
  }

  private routingMode(): "legacy" | "intent" {
    return process.env.AGENT_MESSAGE_ROUTING_MODE?.trim().toLowerCase() ===
      "intent"
      ? "intent"
      : "legacy";
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
