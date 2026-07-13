import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  SettingsPayload,
  SettingsService,
  UpdateSettingsRequest
} from "./settings.service";

@Controller("me/settings")
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<SettingsPayload>> {
    return apiResponse(await this.settingsService.getSettings(currentUserId));
  }

  @Patch()
  async updateSettings(
    @CurrentUserId() currentUserId: string,
    @Body() request: UpdateSettingsRequest | undefined
  ): Promise<ApiSuccessResponse<SettingsPayload>> {
    return apiResponse(
      await this.settingsService.updateSettings(currentUserId, request)
    );
  }
}
