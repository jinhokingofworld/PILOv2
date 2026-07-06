import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { GithubIntegrationModule } from "../github-integration/github-integration.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { PrReviewAnalysisService } from "./pr-review-analysis.service";
import { PrReviewGithubDependencyService } from "./pr-review-github-dependency.service";
import { PrReviewController } from "./pr-review.controller";
import { PrReviewService } from "./pr-review.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule, GithubIntegrationModule],
  controllers: [PrReviewController],
  providers: [
    PrReviewService,
    PrReviewGithubDependencyService,
    PrReviewAnalysisService
  ],
  exports: [
    PrReviewService,
    PrReviewGithubDependencyService,
    PrReviewAnalysisService
  ]
})
export class PrReviewModule {}
