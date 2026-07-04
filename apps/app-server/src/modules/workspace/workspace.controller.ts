import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  CreateWorkspaceRequest,
  WorkspacePayload,
  WorkspaceService
} from "./workspace.service";

@Controller("workspaces")
@UseGuards(AuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  async listWorkspaces(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<WorkspacePayload[]>> {
    const workspaces = await this.workspaceService.listWorkspaces(currentUserId);
    return apiResponse(workspaces);
  }

  @Post()
  async createWorkspace(
    @CurrentUserId() currentUserId: string,
    @Body() body: CreateWorkspaceRequest
  ): Promise<ApiSuccessResponse<WorkspacePayload>> {
    const workspace = await this.workspaceService.createWorkspace(currentUserId, body);
    return apiResponse(workspace);
  }

  @Get(":workspaceId")
  async getWorkspace(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<WorkspacePayload>> {
    const workspace = await this.workspaceService.getWorkspace(currentUserId, workspaceId);
    return apiResponse(workspace);
  }
}
