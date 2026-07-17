import { Module } from "@nestjs/common";
import { WorkspaceIndexingJobService } from "./workspace-indexing-job.service";

@Module({
  providers: [WorkspaceIndexingJobService],
  exports: [WorkspaceIndexingJobService]
})
export class WorkspaceIndexingModule {}
