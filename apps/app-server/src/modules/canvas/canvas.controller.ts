import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards
} from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  CanvasBoardDetailPayload,
  CanvasBoardPayload,
  CanvasShapeDeletePayload,
  CanvasShapePayload,
  CanvasService,
  CreateCanvasRequest,
  CreateCanvasShapeRequest,
  UpdateCanvasShapeRequest
} from "./canvas.service";

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
}
