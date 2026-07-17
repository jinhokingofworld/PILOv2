import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { DriveController } from "./drive.controller";
import { DriveStorageService } from "./drive-storage.service";
import { DriveService } from "./drive.service";
import { DocumentEmbeddingService } from "./document-embedding.service";
import { DocumentService } from "./document.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [DriveController],
  providers: [DocumentService, DocumentEmbeddingService, DriveService, DriveStorageService],
  exports: [DocumentService, DriveService]
})
export class DriveModule {}
