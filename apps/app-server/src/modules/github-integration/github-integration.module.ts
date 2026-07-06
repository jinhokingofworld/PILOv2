import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { GithubAppClient } from "./github-app.client";
import { GithubAppInstallationService } from "./github-app-installation.service";
import { GithubAppInstallationStateService } from "./github-app-installation-state.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubIntegrationController } from "./github-integration.controller";
import { GithubIntegrationService } from "./github-integration.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthIntegrationService } from "./github-oauth-integration.service";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { GithubProjectV2Service } from "./github-project-v2.service";
import { GithubPullRequestRemoteService } from "./github-pull-request-remote.service";
import { GithubReviewSubmissionService } from "./github-review-submission.service";
import { GithubSourceReadService } from "./github-source-read.service";
import { GithubSyncExecutorService } from "./github-sync-executor.service";
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
    GithubOAuthClient,
    GithubOAuthIntegrationService,
    GithubOAuthStateService,
    GithubProjectV2Service,
    GithubPullRequestRemoteService,
    GithubReviewSubmissionService,
    GithubSourceReadService,
    GithubSyncExecutorService,
    GithubSyncRunService,
    GithubTokenEncryptionService,
    GithubWebhookService
  ],
  exports: [GithubIntegrationService]
})
export class GithubIntegrationModule {}
