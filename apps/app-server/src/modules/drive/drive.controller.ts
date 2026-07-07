import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { DriveService } from "./drive.service";
import {
  DriveDeletePayload,
  DriveItemPayload,
  DriveListPayload
} from "./drive.types";

@Controller("workspaces/:workspaceId/drive")
@UseGuards(AuthGuard)
export class DriveController {
  constructor(private readonly driveService: DriveService) {}

  @Get("items")
  async listItems(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query("parentId") parentId: unknown
  ): Promise<ApiSuccessResponse<DriveListPayload>> {
    const result = await this.driveService.listItems(
      currentUserId,
      workspaceId,
      parentId
    );

    return apiResponse(result);
  }

  @Post("folders")
  async createFolder(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: Record<string, unknown>
  ): Promise<ApiSuccessResponse<DriveItemPayload>> {
    const folder = await this.driveService.createFolder(
      currentUserId,
      workspaceId,
      body
    );

    return apiResponse(folder);
  }

  @Patch("items/:itemId")
  async updateItem(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body() body: Record<string, unknown>
  ): Promise<ApiSuccessResponse<DriveItemPayload>> {
    const item = await this.driveService.updateItem(
      currentUserId,
      workspaceId,
      itemId,
      body
    );

    return apiResponse(item);
  }

  @Delete("items/:itemId")
  async deleteItem(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<ApiSuccessResponse<DriveDeletePayload>> {
    const result = await this.driveService.deleteItem(
      currentUserId,
      workspaceId,
      itemId
    );

    return apiResponse(result);
  }
}
