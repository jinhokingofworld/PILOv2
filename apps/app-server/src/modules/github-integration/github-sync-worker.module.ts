import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { GithubAppClient } from "./github-app.client";
import { GithubBoardInvalidationPublisherService } from "./github-board-invalidation-publisher.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubOAuthConnectionService } from "./github-oauth-connection.service";
import { GithubProjectV2SyncTokenService } from "./github-project-v2-sync-token.service";
import { GithubProjectV2PollingService } from "./github-project-v2-polling.service";
import { GithubProjectV2WebhookReconcileService } from "./github-project-v2-webhook-reconcile.service";
import { GithubSourceInvalidationPublisherService } from "./github-source-invalidation-publisher.service";
import { GithubSourceWebhookReconcileService } from "./github-source-webhook-reconcile.service";
import { GithubSyncExecutorService } from "./github-sync-executor.service";
import { GithubSyncJobService } from "./github-sync-job.service";
import { GithubSyncObservabilityService } from "./github-sync-observability.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import { GithubWebhookDeliveryDispatcherService } from "./github-webhook-delivery-dispatcher.service";

@Module({
  imports: [DatabaseModule],
  providers: [
    GithubSyncJobService,
    GithubSyncObservabilityService,
    GithubProjectV2WebhookReconcileService,
    GithubSourceWebhookReconcileService,
    GithubWebhookDeliveryDispatcherService,
    GithubIntegrationConfigService,
    GithubBoardInvalidationPublisherService,
    GithubSourceInvalidationPublisherService,
    GithubSyncExecutorService,
    GithubAppClient,
    GithubProjectV2PollingService,
    GithubProjectV2SyncTokenService,
    GithubOAuthConnectionService,
    GithubTokenEncryptionService
  ]
})
export class GithubSyncWorkerModule {}
