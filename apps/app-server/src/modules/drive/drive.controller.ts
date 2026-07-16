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
import { DocumentService } from "./document.service";
import { DriveService } from "./drive.service";
import {
  DriveDeletePayload,
  DriveDownloadUrlPayload,
  DriveItemPayload,
  DriveListPayload,
  DriveUploadUrlPayload
} from "./drive.types";
import type {
  CreateDocumentPayload,
  DocumentBootstrapPayload,
  SaveDocumentSnapshotPayload
} from "./document.types";

@Controller("workspaces/:workspaceId/drive")
@UseGuards(AuthGuard)
export class DriveController {
  constructor(
    private readonly driveService: DriveService,
    private readonly documentService: DocumentService
  ) {}

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

  @Post("documents")
  async createDocument(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: Record<string, unknown>
  ): Promise<ApiSuccessResponse<CreateDocumentPayload>> {
    const document = await this.documentService.createDocument(
      currentUserId,
      workspaceId,
      body
    );

    return apiResponse(document);
  }

  @Get("documents/:documentId")
  async getDocument(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("documentId") documentId: string
  ): Promise<ApiSuccessResponse<DocumentBootstrapPayload>> {
    const document = await this.documentService.getDocument(
      currentUserId,
      workspaceId,
      documentId
    );

    return apiResponse(document);
  }

  @Put("documents/:documentId/snapshot")
  async saveDocumentSnapshot(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("documentId") documentId: string,
    @Body() body: Record<string, unknown>
  ): Promise<ApiSuccessResponse<SaveDocumentSnapshotPayload>> {
    const document = await this.documentService.saveDocumentSnapshot(
      currentUserId,
      workspaceId,
      documentId,
      body
    );

    return apiResponse(document);
  }

  @Post("files/upload-url")
  async createUploadUrl(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: Record<string, unknown>
  ): Promise<ApiSuccessResponse<DriveUploadUrlPayload>> {
    const result = await this.driveService.createUploadUrl(
      currentUserId,
      workspaceId,
      body
    );

    return apiResponse(result);
  }

  @Post("files/:fileId/complete")
  async completeUpload(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("fileId") fileId: string,
    @Body() body: Record<string, unknown>
  ): Promise<ApiSuccessResponse<DriveItemPayload>> {
    const file = await this.driveService.completeUpload(
      currentUserId,
      workspaceId,
      fileId,
      body
    );

    return apiResponse(file);
  }

  @Get("files/:fileId/download-url")
  async createDownloadUrl(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("fileId") fileId: string
  ): Promise<ApiSuccessResponse<DriveDownloadUrlPayload>> {
    const result = await this.driveService.createDownloadUrl(
      currentUserId,
      workspaceId,
      fileId
    );

    return apiResponse(result);
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
