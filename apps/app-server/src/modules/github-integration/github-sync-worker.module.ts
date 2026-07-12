import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { GithubAppClient } from "./github-app.client";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubProjectV2SyncTokenService } from "./github-project-v2-sync-token.service";
import { GithubProjectV2PollingService } from "./github-project-v2-polling.service";
import { GithubProjectV2WebhookReconcileService } from "./github-project-v2-webhook-reconcile.service";
import { GithubSyncExecutorService } from "./github-sync-executor.service";
import { GithubSyncJobService } from "./github-sync-job.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";

@Module({
  imports: [DatabaseModule],
  providers: [
    GithubSyncJobService,
    GithubProjectV2WebhookReconcileService,
    GithubIntegrationConfigService,
    GithubSyncExecutorService,
    GithubAppClient,
    GithubProjectV2PollingService,
    GithubProjectV2SyncTokenService,
    GithubTokenEncryptionService
  ]
})
export class GithubSyncWorkerModule {}
