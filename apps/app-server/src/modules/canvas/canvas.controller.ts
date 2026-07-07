import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards
} from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { CanvasService } from "./canvas.service";
import {
  CanvasBoardDetailPayload,
  CanvasBoardPayload,
  CanvasLeavePayload,
  CanvasShapeBatchPayload,
  CanvasShapeDeletePayload,
  CanvasShapePayload,
  CanvasShapeSummaryPayload,
  CanvasUserStatePayload,
  CanvasViewSettingPayload,
  CreateCanvasRequest,
  CreateCanvasShapeRequest,
  ListCanvasShapesQuery,
  SyncCanvasShapesBatchRequest,
  UpdateCanvasViewSettingRequest,
  UpdateCanvasShapeRequest
} from "./canvas.types";

@Controller("workspaces/:workspaceId")
@UseGuards(AuthGuard)
export class CanvasController {
  constructor(private readonly canvasService: CanvasService) {}

  @Get("canvases")
  async listCanvases(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<CanvasBoardPayload[]>> {
    const canvases = await this.canvasService.listCanvases(
      currentUserId,
      workspaceId
    );

    return apiResponse(canvases);
  }

  @Post("canvases")
  async createCanvas(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: CreateCanvasRequest
  ): Promise<ApiSuccessResponse<CanvasBoardPayload>> {
    const canvas = await this.canvasService.createCanvas(
      currentUserId,
      workspaceId,
      body
    );

    return apiResponse(canvas);
  }

  @Get("canvases/:canvasId")
  async getCanvas(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("canvasId") canvasId: string
  ): Promise<ApiSuccessResponse<CanvasBoardDetailPayload>> {
    const canvas = await this.canvasService.getCanvas(
      currentUserId,
      workspaceId,
      canvasId
    );

    return apiResponse(canvas);
  }

  @Get("canvases/:canvasId/shapes")
  async listShapesInViewport(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("canvasId") canvasId: string,
    @Query() query: ListCanvasShapesQuery
  ): Promise<ApiSuccessResponse<CanvasShapeSummaryPayload[]>> {
    const shapes = await this.canvasService.listShapesInViewport(
      currentUserId,
      workspaceId,
      canvasId,
      query
    );

    return apiResponse(shapes);
  }

  @Post("canvases/:canvasId/shapes")
  async createShape(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("canvasId") canvasId: string,
    @Body() body: CreateCanvasShapeRequest
  ): Promise<ApiSuccessResponse<CanvasShapePayload>> {
    const shape = await this.canvasService.createShape(
      currentUserId,
      workspaceId,
      canvasId,
      body
    );

    return apiResponse(shape);
  }

  @Post("canvases/:canvasId/shapes/batch")
  async syncShapesBatch(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("canvasId") canvasId: string,
    @Body() body: SyncCanvasShapesBatchRequest
  ): Promise<ApiSuccessResponse<CanvasShapeBatchPayload>> {
    const result = await this.canvasService.syncShapesBatch(
      currentUserId,
      workspaceId,
      canvasId,
      body
    );

    return apiResponse(result);
  }

  @Get("canvas-shapes/:shapeId")
  async getShapeDetail(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("shapeId") shapeId: string
  ): Promise<ApiSuccessResponse<CanvasShapePayload>> {
    const shape = await this.canvasService.getShapeDetail(
      currentUserId,
      workspaceId,
      shapeId
    );

    return apiResponse(shape);
  }

  @Post("canvases/:canvasId/enter")
  async enterCanvas(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("canvasId") canvasId: string
  ): Promise<ApiSuccessResponse<CanvasUserStatePayload>> {
    const userState = await this.canvasService.enterCanvas(
      currentUserId,
      workspaceId,
      canvasId
    );

    return apiResponse(userState);
  }

  @Patch("canvases/:canvasId/leave")
  async leaveCanvas(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("canvasId") canvasId: string
  ): Promise<ApiSuccessResponse<CanvasLeavePayload>> {
    const userState = await this.canvasService.leaveCanvas(
      currentUserId,
      workspaceId,
      canvasId
    );

    return apiResponse(userState);
  }

  @Patch("canvas-shapes/:shapeId")
  async updateShape(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("shapeId") shapeId: string,
    @Body() body: UpdateCanvasShapeRequest
  ): Promise<ApiSuccessResponse<CanvasShapePayload>> {
    const shape = await this.canvasService.updateShape(
      currentUserId,
      workspaceId,
      shapeId,
      body
    );

    return apiResponse(shape);
  }

  @Delete("canvas-shapes/:shapeId")
  async deleteShape(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("shapeId") shapeId: string
  ): Promise<ApiSuccessResponse<CanvasShapeDeletePayload>> {
    const result = await this.canvasService.deleteShape(
      currentUserId,
      workspaceId,
      shapeId
    );

    return apiResponse(result);
  }

  @Put("canvases/:canvasId/view-settings")
  async updateViewSetting(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("canvasId") canvasId: string,
    @Body() body: UpdateCanvasViewSettingRequest
  ): Promise<ApiSuccessResponse<CanvasViewSettingPayload>> {
    const viewSetting = await this.canvasService.updateViewSetting(
      currentUserId,
      workspaceId,
      canvasId,
      body
    );

    return apiResponse(viewSetting);
  }
}
