import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  DeleteCurrentUserPayload,
  DeleteCurrentUserRequest,
  UpdateCurrentUserProfileRequest,
  UpdateCurrentUserPresenceRequest,
  UserPresencePayload,
  UserProfile,
  UserService
} from "./user.service";

@Controller("me")
@UseGuards(AuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async getMe(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<UserProfile>> {
    const user = await this.userService.getCurrentUser(currentUserId);
    return apiResponse(user);
  }

  @Patch("profile")
  async updateProfile(
    @CurrentUserId() currentUserId: string,
    @Body() request: UpdateCurrentUserProfileRequest | undefined
  ): Promise<ApiSuccessResponse<UserProfile>> {
    const user = await this.userService.updateCurrentUserProfile(
      currentUserId,
      request
    );
    return apiResponse(user);
  }

  @Delete()
  async deleteMe(
    @CurrentUserId() currentUserId: string,
    @Body() request: DeleteCurrentUserRequest | undefined
  ): Promise<ApiSuccessResponse<DeleteCurrentUserPayload>> {
    return apiResponse(
      await this.userService.deleteCurrentUser(currentUserId, request)
    );
  }

  @Post("presence")
  async updatePresence(
    @CurrentUserId() currentUserId: string,
    @Body() request: UpdateCurrentUserPresenceRequest | undefined
  ): Promise<ApiSuccessResponse<UserPresencePayload>> {
    const presence = await this.userService.updateCurrentUserPresence(
      currentUserId,
      request
    );
    return apiResponse(presence);
  }
}
