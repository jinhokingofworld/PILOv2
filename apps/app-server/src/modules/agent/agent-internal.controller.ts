import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards
} from "@nestjs/common";
import { AgentExecutionService } from "./agent-execution.service";
import { AgentExecutionHandoffGuard } from "./agent-execution-handoff.guard";
import { AgentConfirmationService } from "./agent-confirmation.service";

@Controller("internal/agent")
@UseGuards(AgentExecutionHandoffGuard)
export class AgentInternalController {
  constructor(
    private readonly agentExecutionService: AgentExecutionService,
    private readonly agentConfirmationService: AgentConfirmationService
  ) {}

  @Post("runs/:runId/execution")
  @HttpCode(HttpStatus.NO_CONTENT)
  async executeRun(@Param("runId") runId: string): Promise<void> {
    await this.agentExecutionService.executeReadyRun(runId);
  }

  @Post("stale-executions/recover")
  @HttpCode(HttpStatus.NO_CONTENT)
  async recoverStaleExecutions(): Promise<void> {
    await this.agentConfirmationService.recoverStaleApprovedExecutions();
  }
}
