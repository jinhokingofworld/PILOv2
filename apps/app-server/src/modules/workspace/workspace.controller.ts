import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards
} from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  AcceptWorkspaceInvitationPayload,
  CreateWorkspaceRequest,
  CreateWorkspaceInvitationPayload,
  CreateWorkspaceInvitationRequest,
  CurrentUserWorkspaceInvitationPayload,
  RemoveWorkspaceMemberPayload,
  WorkspaceInvitationPayload,
  WorkspaceInvitationTokenPayload,
  WorkspaceMemberPayload,
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
    @Body() request: CreateWorkspaceRequest
  ): Promise<ApiSuccessResponse<WorkspacePayload>> {
    const workspace = await this.workspaceService.createWorkspace(
      currentUserId,
      request
    );
    return apiResponse(workspace);
  }

  @Get(":workspaceId/members")
  async listMembers(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<WorkspaceMemberPayload[]>> {
    const members = await this.workspaceService.listMembers(
      currentUserId,
      workspaceId
    );
    return apiResponse(members);
  }

  @Delete(":workspaceId/members/me")
  async leaveWorkspace(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<RemoveWorkspaceMemberPayload>> {
    const result = await this.workspaceService.leaveWorkspace(
      currentUserId,
      workspaceId
    );
    return apiResponse(result);
  }

  @Delete(":workspaceId/members/:userId")
  async removeMember(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("userId") userId: string
  ): Promise<ApiSuccessResponse<RemoveWorkspaceMemberPayload>> {
    const result = await this.workspaceService.removeMember(
      currentUserId,
      workspaceId,
      userId
    );
    return apiResponse(result);
  }

  @Get(":workspaceId/invitations")
  async listInvitations(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<WorkspaceInvitationPayload[]>> {
    const invitations = await this.workspaceService.listInvitations(
      currentUserId,
      workspaceId
    );
    return apiResponse(invitations);
  }

  @Post(":workspaceId/invitations")
  async createInvitation(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() request: CreateWorkspaceInvitationRequest
  ): Promise<ApiSuccessResponse<CreateWorkspaceInvitationPayload>> {
    const invitation = await this.workspaceService.createInvitation(
      currentUserId,
      workspaceId,
      request
    );
    return apiResponse(invitation);
  }

  @Get(":workspaceId")
  async getWorkspace(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<WorkspacePayload>> {
    const workspace = await this.workspaceService.getWorkspace(
      currentUserId,
      workspaceId
    );
    return apiResponse(workspace);
  }
}

@Controller("me/workspace-invitations")
@UseGuards(AuthGuard)
export class CurrentUserWorkspaceInvitationController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  async listCurrentUserInvitations(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<CurrentUserWorkspaceInvitationPayload[]>> {
    const invitations =
      await this.workspaceService.listCurrentUserInvitations(currentUserId);
    return apiResponse(invitations);
  }

  @Post(":invitationId/accept")
  async acceptCurrentUserInvitation(
    @CurrentUserId() currentUserId: string,
    @Param("invitationId") invitationId: string
  ): Promise<ApiSuccessResponse<AcceptWorkspaceInvitationPayload>> {
    const result = await this.workspaceService.acceptCurrentUserInvitation(
      currentUserId,
      invitationId
    );
    return apiResponse(result);
  }

  @Post(":invitationId/reject")
  async rejectCurrentUserInvitation(
    @CurrentUserId() currentUserId: string,
    @Param("invitationId") invitationId: string
  ): Promise<ApiSuccessResponse<WorkspaceInvitationPayload>> {
    const invitation = await this.workspaceService.rejectCurrentUserInvitation(
      currentUserId,
      invitationId
    );
    return apiResponse(invitation);
  }
}

@Controller("workspace-invitations")
@UseGuards(AuthGuard)
export class WorkspaceInvitationController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get(":invitationToken")
  async getInvitation(
    @Param("invitationToken") invitationToken: string
  ): Promise<ApiSuccessResponse<WorkspaceInvitationTokenPayload>> {
    const invitation =
      await this.workspaceService.getInvitationByToken(invitationToken);
    return apiResponse(invitation);
  }

  @Post(":invitationToken/accept")
  async acceptInvitation(
    @CurrentUserId() currentUserId: string,
    @Param("invitationToken") invitationToken: string
  ): Promise<ApiSuccessResponse<AcceptWorkspaceInvitationPayload>> {
    const result = await this.workspaceService.acceptInvitation(
      currentUserId,
      invitationToken
    );
    return apiResponse(result);
  }
}
