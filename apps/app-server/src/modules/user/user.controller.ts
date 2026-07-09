import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
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
