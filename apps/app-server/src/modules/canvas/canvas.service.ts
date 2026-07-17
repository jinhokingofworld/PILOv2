import { Injectable } from "@nestjs/common";
import { CanvasBoardService } from "./board/canvas-board.service";
import type {
  CanvasBoardDetailPayload,
  CanvasBoardPayload,
  CanvasLeavePayload,
  CanvasOperationsCatchupPayload,
  CanvasShapeBatchPayload,
  CanvasShapeDeletePayload,
  CanvasShapePayload,
  CanvasShapeSummaryPayload,
  CanvasSyncDocumentPayload,
  CanvasUserStatePayload,
  CanvasViewSettingPayload,
  ConvertCanvasEngineRequest,
  CreateCanvasRequest,
  CreateCanvasShapeRequest,
  DeleteCanvasShapeRequest,
  ListCanvasOperationsQuery,
  ListCanvasShapesQuery,
  SyncCanvasShapesBatchRequest,
  UpdateCanvasShapeRequest,
  UpdateCanvasSyncDocumentRequest,
  UpdateCanvasViewSettingRequest
} from "./contracts/canvas.types";
import { CanvasOperationQueryService } from "./operation/canvas-operation-query.service";
import { CanvasShapeCommandService } from "./shape/canvas-shape-command.service";
import { CanvasShapeQueryService } from "./shape/canvas-shape-query.service";
import { CanvasSyncDocumentService } from "./sync-document/canvas-sync-document.service";
import { CanvasUserStateService } from "./user-state/canvas-user-state.service";

@Injectable()
export class CanvasService {
  constructor(
    private readonly boardService: CanvasBoardService,
    private readonly operationQueryService: CanvasOperationQueryService,
    private readonly shapeCommandService: CanvasShapeCommandService,
    private readonly shapeQueryService: CanvasShapeQueryService,
    private readonly syncDocumentService: CanvasSyncDocumentService,
    private readonly userStateService: CanvasUserStateService
  ) {}

  listCanvases(
    currentUserId: string,
    workspaceId: string
  ): Promise<CanvasBoardPayload[]> {
    return this.boardService.listCanvases(currentUserId, workspaceId);
  }

  createCanvas(
    currentUserId: string,
    workspaceId: string,
    input: CreateCanvasRequest
  ): Promise<CanvasBoardPayload> {
    return this.boardService.createCanvas(currentUserId, workspaceId, input);
  }

  convertCanvasEngine(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: ConvertCanvasEngineRequest
  ): Promise<CanvasBoardPayload> {
    return this.boardService.convertCanvasEngine(
      currentUserId,
      workspaceId,
      canvasId,
      input
    );
  }

  getCanvas(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasBoardDetailPayload> {
    return this.boardService.getCanvas(currentUserId, workspaceId, canvasId);
  }

  listShapesInViewport(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: ListCanvasShapesQuery
  ): Promise<CanvasShapeSummaryPayload[]> {
    return this.shapeQueryService.listShapesInViewport(
      currentUserId,
      workspaceId,
      canvasId,
      input
    );
  }

  listOperationsAfterSeq(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: ListCanvasOperationsQuery
  ): Promise<CanvasOperationsCatchupPayload> {
    return this.operationQueryService.listOperationsAfterSeq(
      currentUserId,
      workspaceId,
      canvasId,
      input
    );
  }

  createShape(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: CreateCanvasShapeRequest
  ): Promise<CanvasShapePayload> {
    return this.shapeCommandService.createShape(
      currentUserId,
      workspaceId,
      canvasId,
      input
    );
  }

  syncShapesBatch(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: SyncCanvasShapesBatchRequest,
    _actorType = "user"
  ): Promise<CanvasShapeBatchPayload> {
    return this.shapeCommandService.syncShapesBatch(
      currentUserId,
      workspaceId,
      canvasId,
      input,
      _actorType
    );
  }

  getShapeDetail(
    currentUserId: string,
    workspaceId: string,
    shapeId: string
  ): Promise<CanvasShapePayload> {
    return this.shapeQueryService.getShapeDetail(
      currentUserId,
      workspaceId,
      shapeId
    );
  }

  enterCanvas(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasUserStatePayload> {
    return this.userStateService.enterCanvas(
      currentUserId,
      workspaceId,
      canvasId
    );
  }

  leaveCanvas(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasLeavePayload> {
    return this.userStateService.leaveCanvas(
      currentUserId,
      workspaceId,
      canvasId
    );
  }

  updateViewSetting(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: UpdateCanvasViewSettingRequest
  ): Promise<CanvasViewSettingPayload> {
    return this.boardService.updateViewSetting(
      currentUserId,
      workspaceId,
      canvasId,
      input
    );
  }

  getCanvasSyncDocument(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasSyncDocumentPayload> {
    return this.syncDocumentService.getCanvasSyncDocument(
      currentUserId,
      workspaceId,
      canvasId
    );
  }

  updateCanvasSyncDocument(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: UpdateCanvasSyncDocumentRequest
  ): Promise<CanvasSyncDocumentPayload> {
    return this.syncDocumentService.updateCanvasSyncDocument(
      currentUserId,
      workspaceId,
      canvasId,
      input
    );
  }

  updateShape(
    currentUserId: string,
    workspaceId: string,
    shapeId: string,
    input: UpdateCanvasShapeRequest
  ): Promise<CanvasShapePayload> {
    return this.shapeCommandService.updateShape(
      currentUserId,
      workspaceId,
      shapeId,
      input
    );
  }

  deleteShape(
    currentUserId: string,
    workspaceId: string,
    shapeId: string,
    input: DeleteCanvasShapeRequest | undefined
  ): Promise<CanvasShapeDeletePayload> {
    return this.shapeCommandService.deleteShape(
      currentUserId,
      workspaceId,
      shapeId,
      input
    );
  }
}
