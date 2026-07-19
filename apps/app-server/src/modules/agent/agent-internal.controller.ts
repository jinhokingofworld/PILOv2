import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Body,
  Get,
  Post,
  UseGuards
} from "@nestjs/common";
import { AgentExecutionService } from "./agent-execution.service";
import { AgentExecutionHandoffGuard } from "./agent-execution-handoff.guard";
import { AgentConfirmationService } from "./agent-confirmation.service";
import { AgentGroundedAnswerService } from "./agent-grounded-answer.service";
import { AgentOutboxPublisherService } from "./agent-outbox-publisher.service";
import { MeetingActionItemDeliveryService } from "../meeting/meeting-action-item-delivery.service";

@Controller("internal/agent")
@UseGuards(AgentExecutionHandoffGuard)
export class AgentInternalController {
  constructor(
    private readonly agentExecutionService: AgentExecutionService,
    private readonly agentConfirmationService: AgentConfirmationService,
    private readonly agentGroundedAnswerService: AgentGroundedAnswerService,
    private readonly agentOutboxPublisherService: AgentOutboxPublisherService,
    private readonly meetingActionItemDeliveryService: MeetingActionItemDeliveryService
  ) {}

  @Post("runs/:runId/execution")
  @HttpCode(HttpStatus.NO_CONTENT)
  async executeRun(@Param("runId") runId: string): Promise<void> {
    await this.agentExecutionService.executeReadyRun(runId);
  }

  @Post("stale-executions/recover")
  @HttpCode(HttpStatus.NO_CONTENT)
  async recoverStaleExecutions(): Promise<void> {
    await this.agentOutboxPublisherService.recoverStalePlanningRuns();
    await this.agentConfirmationService.recoverStaleApprovedExecutions();
    await this.meetingActionItemDeliveryService.recoverStaleDeliveries();
  }

  @Get("runs/:runId/grounding-context")
  async getGroundingContext(@Param("runId") runId: string): Promise<unknown> {
    return this.agentGroundedAnswerService.getContext(runId);
  }

  @Post("runs/:runId/grounded-answer")
  @HttpCode(HttpStatus.NO_CONTENT)
  async completeGroundedAnswer(@Param("runId") runId: string, @Body() body: unknown): Promise<void> {
    const value = body as { answer?: unknown; citations?: unknown };
    const answer = typeof value?.answer === "string" ? value.answer : "";
    const citations = Array.isArray(value?.citations) ? value.citations.filter((item): item is string => typeof item === "string") : [];
    await this.agentGroundedAnswerService.complete(runId, answer, citations);
  }

  @Post("runs/:runId/grounded-answer/no-sources")
  @HttpCode(HttpStatus.NO_CONTENT)
  async completeWithoutSources(@Param("runId") runId: string): Promise<void> {
    await this.agentGroundedAnswerService.completeWithoutSources(runId);
  }
}
