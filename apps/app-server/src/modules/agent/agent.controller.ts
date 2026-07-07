import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  AgentConfirmationActionPayload,
  AgentConfirmationService
} from "./agent-confirmation.service";

@Controller("workspaces/:workspaceId/agent")
@UseGuards(AuthGuard)
export class AgentController {
  constructor(private readonly agentConfirmationService: AgentConfirmationService) {}

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
