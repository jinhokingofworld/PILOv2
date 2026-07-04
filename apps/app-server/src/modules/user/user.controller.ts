import { Controller, Get, UseGuards } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { UserProfile, UserService } from "./user.service";

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
}
