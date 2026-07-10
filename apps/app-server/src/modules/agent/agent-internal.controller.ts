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

@Controller("internal/agent")
@UseGuards(AgentExecutionHandoffGuard)
export class AgentInternalController {
  constructor(private readonly agentExecutionService: AgentExecutionService) {}

  @Post("runs/:runId/execution")
  @HttpCode(HttpStatus.NO_CONTENT)
  async executeRun(@Param("runId") runId: string): Promise<void> {
    await this.agentExecutionService.executeReadyRun(runId);
  }
}
