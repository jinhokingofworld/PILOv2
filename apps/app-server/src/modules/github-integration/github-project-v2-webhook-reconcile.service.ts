import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service";
import { GithubAppClient } from "./github-app.client";
import {
  GithubIntegrationConfigService,
  type GithubAppRuntimeConfig
} from "./github-integration-config.service";
import {
  GithubSyncExecutorService,
  type GithubSyncRunContext
} from "./github-sync-executor.service";

interface GithubProjectV2WebhookDeliveryClaim extends QueryResultRow {
  delivery_id: string;
  project_item_node_id: string;
  github_installation_id: string | number;
  project_v2_node_id: string;
}

interface GithubProjectV2WebhookSelectedTarget extends QueryResultRow {
  workspace_id: string;
  installation_id: string;
  github_installation_id: string | number;
  account_login: string;
  account_type: "Organization";
  project_v2_id: string;
  project_v2_installation_id: string;
  project_v2_workspace_id: string;
  github_project_node_id: string;
  repository_id: string;
  repository_workspace_id: string;
  repository_installation_id: string | null;
  repository_github_node_id: string | null;
  repository_owner_login: string;
  repository_name: string;
  repository_full_name: string;
}

interface DeliveryIdRow extends QueryResultRow {
  delivery_id: string;
}

export interface GithubWebhookDeliveryRecoveryFailure {
  deliveryId: string;
  error: unknown;
}

const WEBHOOK_RECONCILE_ERROR_MESSAGE =
  "GitHub ProjectV2 webhook reconcile failed";
const WEBHOOK_RECONCILE_RECOVERY_COOLDOWN = "6 minutes";

@Injectable()
export class GithubProjectV2WebhookReconcileService {
  private readonly workerId =
    `${process.env.HOSTNAME ?? "github-sync-worker"}-${process.pid}`;
  private publicationAttempt = 0;

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly githubAppClient: GithubAppClient,
    private readonly executor: GithubSyncExecutorService
  ) {}

  async processDelivery(deliveryId: string): Promise<"terminal" | "retry"> {
    let claim: GithubProjectV2WebhookDeliveryClaim | null;
    try {
      claim = await this.claimDelivery(deliveryId);
    } catch {
      return "retry";
    }

    if (!claim) {
      return "terminal";
    }

    try {
      const targets = await this.listSelectedTargets(claim);
      if (targets.length === 0) {
        await this.markProcessed(claim);
        return "terminal";
      }

      const config = this.configService.getGithubAppConfig();
      const item = await this.githubAppClient.getProjectV2Item({
        installationId: this.toGithubInstallationId(claim.github_installation_id),
        appId: config.appId,
        privateKey: config.privateKey,
        now: config.now,
        projectItemNodeId: claim.project_item_node_id,
        accountType: "Organization"
      });

      for (const target of targets) {
        const context = this.toSyncContext(claim, target, config);
        if (item) {
          await this.executor.reconcileGithubProjectV2WebhookItem(context, item);
        } else {
          await this.executor.archiveGithubProjectV2WebhookItem(
            context,
            claim.project_item_node_id
          );
        }
      }

      await this.markProcessed(claim);
      return "terminal";
    } catch {
      try {
        await this.releaseForRetry(claim);
      } catch {
        // The queue retry will make the delivery claimable once its lease expires.
      }
      return "retry";
    }
  }

  async recoverDeliveries(
    enqueueDelivery: (deliveryId: string) => Promise<void>
  ): Promise<GithubWebhookDeliveryRecoveryFailure[]> {
    const rows = await this.database.query<DeliveryIdRow>(
      `SELECT delivery_id FROM github_webhook_deliveries
       WHERE (
         status = 'failed'
         AND error_message = 'GitHub webhook could not be enqueued'
       ) OR (
         status = 'received'
         AND error_message = 'GitHub webhook enqueue is pending'
       ) OR (
         status = 'received'
         AND error_message = 'GitHub ProjectV2 webhook reconcile failed'
         AND (
           lease_expires_at < now()
           OR lease_expires_at IS NULL
         )
       ) OR (
         status = 'received'
         AND error_message = 'GitHub webhook enqueue is publishing'
         AND lease_expires_at < now()
       ) OR (
         status = 'processing'
         AND lease_expires_at < now()
       )
       ORDER BY received_at ASC LIMIT 10`
    );
    const failures: GithubWebhookDeliveryRecoveryFailure[] = [];

    for (const row of rows) {
      const publicationOwner = this.nextPublicationOwner();
      try {
        if (!await this.claimRecoveredDeliveryForPublication(row.delivery_id, publicationOwner)) {
          continue;
        }
        await enqueueDelivery(row.delivery_id);
      } catch (error) {
        try {
          await this.releaseRecoveredDeliveryForPublication(row.delivery_id, publicationOwner);
        } catch {
          // The lease expires into a recoverable publishing state when release fails.
        }
        failures.push({ deliveryId: row.delivery_id, error });
        continue;
      }

      try {
        await this.markRecoveredDeliveryPublished(row.delivery_id, publicationOwner);
      } catch (error) {
        failures.push({ deliveryId: row.delivery_id, error });
      }
    }

    return failures;
  }

  private async claimDelivery(
    deliveryId: string
  ): Promise<GithubProjectV2WebhookDeliveryClaim | null> {
    return this.database.queryOne<GithubProjectV2WebhookDeliveryClaim>(
      `
        UPDATE github_webhook_deliveries
        SET
          status = 'processing',
          attempt_count = attempt_count + 1,
          lease_owner = $2,
          lease_expires_at = now() + interval '10 minutes',
          processed_at = NULL,
          error_message = NULL
        WHERE delivery_id = $1
          AND (
            status = 'received'
            OR (status = 'processing' AND lease_expires_at < now())
          )
        RETURNING
          delivery_id,
          project_item_node_id,
          github_installation_id,
          project_v2_node_id
      `,
      [deliveryId, this.workerId]
    );
  }

  private async listSelectedTargets(
    claim: GithubProjectV2WebhookDeliveryClaim
  ): Promise<GithubProjectV2WebhookSelectedTarget[]> {
    return this.database.query<GithubProjectV2WebhookSelectedTarget>(
      `
        SELECT
          installation.workspace_id,
          installation.id AS installation_id,
          installation.github_installation_id,
          installation.account_login,
          installation.account_type,
          project.id AS project_v2_id,
          project.installation_id AS project_v2_installation_id,
          project.workspace_id AS project_v2_workspace_id,
          project.github_project_node_id,
          repository.id AS repository_id,
          repository.workspace_id AS repository_workspace_id,
          repository.installation_id AS repository_installation_id,
          repository.github_node_id AS repository_github_node_id,
          repository.owner_login AS repository_owner_login,
          repository.name AS repository_name,
          repository.full_name AS repository_full_name
        FROM github_installations AS installation
        JOIN github_projects_v2 AS project
          ON project.installation_id = installation.id
          AND project.workspace_id = installation.workspace_id
        JOIN github_project_v2_selections AS selection
          ON selection.installation_id = installation.id
          AND selection.project_v2_id = project.id
        JOIN github_repositories AS repository
          ON repository.id = selection.repository_id
          AND repository.workspace_id = installation.workspace_id
          AND repository.installation_id = installation.id
        WHERE installation.github_installation_id = $1
          AND project.github_project_node_id = $2
          AND project.owner_type = 'Organization'
        ORDER BY installation.workspace_id ASC, project.id ASC, repository.id ASC
      `,
      [claim.github_installation_id, claim.project_v2_node_id]
    );
  }

  private async markProcessed(
    claim: GithubProjectV2WebhookDeliveryClaim
  ): Promise<void> {
    const result = await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          status='processed',
          processed_at=now(),
          error_message=NULL,
          lease_owner=NULL,
          lease_expires_at=NULL
        WHERE delivery_id=$1
          AND status='processing'
          AND lease_owner=$2
      `,
      [claim.delivery_id, this.workerId]
    );
    if (result.rowCount !== 1) {
      throw new Error(WEBHOOK_RECONCILE_ERROR_MESSAGE);
    }
  }

  private async releaseForRetry(
    claim: GithubProjectV2WebhookDeliveryClaim
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          status='received',
          processed_at=NULL,
          error_message=$3,
          lease_owner=NULL,
          lease_expires_at=now() + interval '${WEBHOOK_RECONCILE_RECOVERY_COOLDOWN}'
        WHERE delivery_id=$1
          AND status='processing'
          AND lease_owner=$2
      `,
      [claim.delivery_id, this.workerId, WEBHOOK_RECONCILE_ERROR_MESSAGE]
    );
  }

  private async claimRecoveredDeliveryForPublication(
    deliveryId: string,
    publicationOwner: string
  ): Promise<boolean> {
    const result = await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          status='received',
          processed_at=NULL,
          error_message='GitHub webhook enqueue is publishing',
          lease_owner=$2,
          lease_expires_at=now() + interval '10 minutes'
        WHERE delivery_id=$1 AND (
          (status='failed' AND error_message='GitHub webhook could not be enqueued')
          OR (status='received' AND error_message='GitHub webhook enqueue is pending')
          OR (
            status='received'
            AND error_message='GitHub ProjectV2 webhook reconcile failed'
            AND (
              lease_expires_at < now()
              OR lease_expires_at IS NULL
            )
          )
          OR (
            status='received'
            AND error_message='GitHub webhook enqueue is publishing'
            AND lease_expires_at < now()
          )
          OR (status='processing' AND lease_expires_at < now())
        )
      `,
      [deliveryId, publicationOwner]
    );

    return result.rowCount === 1;
  }

  private async markRecoveredDeliveryPublished(
    deliveryId: string,
    publicationOwner: string
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          error_message=NULL,
          lease_owner=NULL,
          lease_expires_at=NULL
        WHERE delivery_id=$1
          AND status='received'
          AND error_message='GitHub webhook enqueue is publishing'
          AND lease_owner=$2
      `,
      [deliveryId, publicationOwner]
    );
  }

  private async releaseRecoveredDeliveryForPublication(
    deliveryId: string,
    publicationOwner: string
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          error_message='GitHub webhook enqueue is pending',
          lease_owner=NULL,
          lease_expires_at=NULL
        WHERE delivery_id=$1
          AND status='received'
          AND error_message='GitHub webhook enqueue is publishing'
          AND lease_owner=$2
      `,
      [deliveryId, publicationOwner]
    );
  }

  private nextPublicationOwner(): string {
    this.publicationAttempt += 1;
    return `${this.workerId}-publish-${this.publicationAttempt}`;
  }

  private toSyncContext(
    claim: GithubProjectV2WebhookDeliveryClaim,
    target: GithubProjectV2WebhookSelectedTarget,
    config: GithubAppRuntimeConfig
  ): GithubSyncRunContext {
    return {
      currentUserId: "github-webhook-worker",
      workspaceId: target.workspace_id,
      installation: {
        id: target.installation_id,
        workspace_id: target.workspace_id,
        github_installation_id: target.github_installation_id,
        account_login: target.account_login,
        account_type: target.account_type
      },
      repository: {
        id: target.repository_id,
        workspace_id: target.repository_workspace_id,
        installation_id: target.repository_installation_id,
        github_node_id: target.repository_github_node_id,
        owner_login: target.repository_owner_login,
        name: target.repository_name,
        full_name: target.repository_full_name
      },
      projectV2: {
        id: target.project_v2_id,
        workspace_id: target.project_v2_workspace_id,
        installation_id: target.project_v2_installation_id,
        github_project_node_id: target.github_project_node_id
      },
      githubUserAccessToken: null,
      config
    };
  }

  private toGithubInstallationId(value: string | number): number {
    const installationId = Number(value);
    if (!Number.isSafeInteger(installationId)) {
      throw new Error(WEBHOOK_RECONCILE_ERROR_MESSAGE);
    }

    return installationId;
  }
}
