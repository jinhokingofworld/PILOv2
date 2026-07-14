import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { GithubIntegrationModule } from "../github-integration/github-integration.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { PrReviewAnalysisService } from "./pr-review-analysis.service";
import { PrReviewAnalysisHandoffGuard } from "./pr-review-analysis-handoff.guard";
import { PrReviewAnalysisInternalController } from "./pr-review-analysis-internal.controller";
import { PrReviewAnalysisJobPublisherService } from "./pr-review-analysis-job-publisher.service";
import { PrReviewAnalysisJobRecoveryService } from "./pr-review-analysis-job-recovery.service";
import { PrReviewAnalysisJobService } from "./pr-review-analysis-job.service";
import { PrReviewGithubDependencyService } from "./pr-review-github-dependency.service";
import { PrReviewController } from "./pr-review.controller";
import { PrReviewDecisionRealtimePublisherService } from "./pr-review-decision-realtime-publisher.service";
import { PrReviewConflictDraftRealtimePublisherService } from "./pr-review-conflict-draft-realtime-publisher.service";
import { PrReviewService } from "./pr-review.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule, GithubIntegrationModule],
  controllers: [PrReviewController, PrReviewAnalysisInternalController],
  providers: [
    PrReviewService,
    PrReviewGithubDependencyService,
    PrReviewAnalysisService,
    PrReviewAnalysisHandoffGuard,
    PrReviewAnalysisJobService,
    PrReviewAnalysisJobPublisherService,
    PrReviewAnalysisJobRecoveryService,
    PrReviewDecisionRealtimePublisherService,
    PrReviewConflictDraftRealtimePublisherService
  ],
  exports: [
    PrReviewService,
    PrReviewGithubDependencyService,
    PrReviewAnalysisService,
    PrReviewAnalysisJobService,
    PrReviewAnalysisJobPublisherService,
    PrReviewAnalysisJobRecoveryService,
    PrReviewDecisionRealtimePublisherService,
    PrReviewConflictDraftRealtimePublisherService
  ]
})
export class PrReviewModule {}
