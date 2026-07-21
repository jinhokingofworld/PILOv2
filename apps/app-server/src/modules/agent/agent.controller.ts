import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  AgentConfirmationActionPayload,
  AgentConfirmationService
} from "./agent-confirmation.service";
import {
  AgentRunCreatePayload,
  AgentRunDetailPayload,
  AgentRunListPayload,
  AgentRunListQuery,
  AgentService
} from "./agent.service";
import {
  AgentContextNavigationPayload,
  AgentThreadContextService
} from "./agent-thread-context.service";

@Controller("workspaces/:workspaceId/agent")
@UseGuards(AuthGuard)
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly agentConfirmationService: AgentConfirmationService,
    private readonly agentThreadContextService: AgentThreadContextService
  ) {}

  @Post("runs")
  async createRun(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<AgentRunCreatePayload>> {
    const result = await this.agentService.createRun(
      currentUserId,
      workspaceId,
      body
    );

    reply.status(result.created ? 201 : 200);
    return apiResponse({
      run: result.run
    });
  }

  @Get("runs")
  async listRuns(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: AgentRunListQuery
  ): Promise<ApiSuccessResponse<AgentRunListPayload>> {
    const result = await this.agentService.listRuns(
      currentUserId,
      workspaceId,
      query
    );

    return apiResponse(result);
  }

  @Get("runs/:runId")
  async getRun(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("runId") runId: string
  ): Promise<ApiSuccessResponse<AgentRunDetailPayload>> {
    const result = await this.agentService.getRun(
      currentUserId,
      workspaceId,
      runId
    );

    return apiResponse(result);
  }

  @Get("runs/:runId/context-references/:contextRef/navigation")
  async resolveContextNavigation(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("runId") runId: string,
    @Param("contextRef") contextRef: string
  ): Promise<ApiSuccessResponse<AgentContextNavigationPayload>> {
    const result = await this.agentThreadContextService.resolveNavigation(
      currentUserId,
      workspaceId,
      runId,
      contextRef
    );
    return apiResponse(result);
  }

  @Post("runs/:runId/inputs")
  async submitRunInput(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("runId") runId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<AgentRunDetailPayload>> {
    const result = await this.agentService.submitRunInput(
      currentUserId,
      workspaceId,
      runId,
      body
    );
    return apiResponse(result);
  }

  @Post("runs/:runId/confirmations/:confirmationId/approve")
  async approveConfirmation(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("runId") runId: string,
    @Param("confirmationId") confirmationId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<AgentConfirmationActionPayload>> {
    const result = await this.agentConfirmationService.approveConfirmation(
      currentUserId,
      workspaceId,
      runId,
      confirmationId,
      body
    );

    return apiResponse(result);
  }

  @Post("runs/:runId/confirmations/:confirmationId/reject")
  async rejectConfirmation(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("runId") runId: string,
    @Param("confirmationId") confirmationId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<AgentConfirmationActionPayload>> {
    const result = await this.agentConfirmationService.rejectConfirmation(
      currentUserId,
      workspaceId,
      runId,
      confirmationId,
      body
    );

    return apiResponse(result);
  }
}
