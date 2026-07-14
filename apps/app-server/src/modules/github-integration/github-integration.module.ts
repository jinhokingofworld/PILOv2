import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { GithubAppClient } from "./github-app.client";
import { GithubAppInstallationService } from "./github-app-installation.service";
import { GithubAppInstallationStateService } from "./github-app-installation-state.service";
import { GithubBoardInvalidationPublisherService } from "./github-board-invalidation-publisher.service";
import { GithubCallbackStateService } from "./github-callback-state.service";
import { GithubConflictMergeService } from "./github-conflict-merge.service";
import { GithubGitCommandRunner } from "./github-git-command-runner";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubIntegrationController } from "./github-integration.controller";
import { GithubIntegrationService } from "./github-integration.service";
import { GithubIssueWriteService } from "./github-issue-write.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthConnectionService } from "./github-oauth-connection.service";
import { GithubOAuthIntegrationService } from "./github-oauth-integration.service";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { GithubProjectOAuthIntegrationService } from "./github-project-oauth-integration.service";
import { GithubProjectV2SyncTokenService } from "./github-project-v2-sync-token.service";
import { GithubProjectV2PollingService } from "./github-project-v2-polling.service";
import { GithubProjectV2WebhookReconcileService } from "./github-project-v2-webhook-reconcile.service";
import { GithubProjectV2Service } from "./github-project-v2.service";
import { GithubProjectV2WriteService } from "./github-project-v2-write.service";
import { GithubPullRequestFileWriteService } from "./github-pull-request-file-write.service";
import { GithubPullRequestMergeService } from "./github-pull-request-merge.service";
import { GithubPullRequestRemoteService } from "./github-pull-request-remote.service";
import { GithubReviewSubmissionService } from "./github-review-submission.service";
import { GithubSourceReadService } from "./github-source-read.service";
import { GithubSyncExecutorService } from "./github-sync-executor.service";
import { GithubSyncJobService } from "./github-sync-job.service";
import { GithubSyncRunService } from "./github-sync-run.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import { GithubWebhookService } from "./github-webhook.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [GithubIntegrationController],
  providers: [
    GithubIntegrationService,
    GithubIntegrationConfigService,
    GithubAppClient,
    GithubAppInstallationService,
    GithubAppInstallationStateService,
    GithubBoardInvalidationPublisherService,
    GithubCallbackStateService,
    GithubConflictMergeService,
    GithubGitCommandRunner,
    GithubIssueWriteService,
    GithubOAuthClient,
    GithubOAuthConnectionService,
    GithubOAuthIntegrationService,
    GithubOAuthStateService,
    GithubProjectOAuthIntegrationService,
    GithubProjectV2PollingService,
    GithubProjectV2SyncTokenService,
    GithubProjectV2Service,
    GithubProjectV2WriteService,
    GithubPullRequestFileWriteService,
    GithubPullRequestMergeService,
    GithubPullRequestRemoteService,
    GithubReviewSubmissionService,
    GithubSourceReadService,
    GithubSyncExecutorService,
    GithubSyncJobService,
    GithubProjectV2WebhookReconcileService,
    GithubSyncRunService,
    GithubTokenEncryptionService,
    GithubWebhookService
  ],
  exports: [
    GithubIntegrationService,
    GithubProjectV2Service,
    GithubOAuthConnectionService,
    GithubIssueWriteService,
    GithubProjectV2WriteService
  ]
})
export class GithubIntegrationModule {}
