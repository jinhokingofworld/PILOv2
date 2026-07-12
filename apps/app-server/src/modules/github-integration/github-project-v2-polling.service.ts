import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { DatabaseService, type DatabaseTransaction } from "../../database/database.service";

interface GithubProjectV2PollingClaimRow extends QueryResultRow {
  sync_run_id: string;
  repository_id: string;
  project_v2_id: string;
  requested_by_user_id: string;
}

export interface GithubProjectV2PollingClaim {
  syncRunId: string;
  repositoryId: string;
  projectV2Id: string;
  requestedByUserId: string;
}

type GithubProjectV2PollingQueryExecutor = Pick<DatabaseService | DatabaseTransaction, "execute">;

@Injectable()
export class GithubProjectV2PollingService {
  private readonly leaseOwner = `${process.env.HOSTNAME ?? "github-sync-worker"}-${process.pid}`;

  constructor(private readonly database: DatabaseService) {}

  async syncSelectionSchedules(input: {
    repositoryId: string;
    requestedByUserId: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          DELETE FROM github_project_v2_polling_schedules AS schedule
          WHERE schedule.repository_id = $1
            AND NOT EXISTS (
              SELECT 1
              FROM github_project_v2_selections AS selection
              INNER JOIN github_projects_v2 AS project
                ON project.id = selection.project_v2_id
              WHERE selection.repository_id = schedule.repository_id
                AND selection.project_v2_id = schedule.project_v2_id
                AND project.owner_type = 'User'
            )
        `,
        [input.repositoryId]
      );

      await transaction.execute(
        `
          INSERT INTO github_project_v2_polling_schedules (
            repository_id,
            project_v2_id,
            requested_by_user_id,
            next_poll_at
          )
          SELECT
            selection.repository_id,
            selection.project_v2_id,
            $2,
            now()
          FROM github_project_v2_selections AS selection
          INNER JOIN github_projects_v2 AS project
            ON project.id = selection.project_v2_id
          WHERE selection.repository_id = $1
            AND project.owner_type = 'User'
          ON CONFLICT (repository_id, project_v2_id)
          DO UPDATE SET
            requested_by_user_id = EXCLUDED.requested_by_user_id,
            updated_at = now()
        `,
        [input.repositoryId, input.requestedByUserId]
      );
    });
  }

  async claimDueSchedules(limit: number): Promise<GithubProjectV2PollingClaim[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("GitHub ProjectV2 polling claim limit must be a positive integer");
    }

    const rows = await this.database.query<GithubProjectV2PollingClaimRow>(
      `
        WITH candidate_schedules AS (
          SELECT
            schedule.repository_id,
            schedule.project_v2_id,
            schedule.requested_by_user_id,
            repository.workspace_id,
            repository.installation_id,
            CASE
              WHEN schedule.active_sync_run_id IS NOT NULL
                AND schedule.lease_expires_at < now()
                AND EXISTS (
                  SELECT 1
                  FROM github_sync_runs AS active_run
                  WHERE active_run.id = schedule.active_sync_run_id
                    AND active_run.status IN ('queued', 'running')
                )
                AND (
                  NOT EXISTS (
                    SELECT 1
                    FROM github_sync_jobs AS active_job
                    WHERE active_job.sync_run_id = schedule.active_sync_run_id
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM github_sync_jobs AS active_job
                    WHERE active_job.sync_run_id = schedule.active_sync_run_id
                      AND active_job.status IN ('queued', 'running')
                  )
                )
              THEN schedule.active_sync_run_id
              ELSE NULL
            END AS reusable_sync_run_id
          FROM github_project_v2_polling_schedules AS schedule
          INNER JOIN github_repositories AS repository
            ON repository.id = schedule.repository_id
          INNER JOIN github_projects_v2 AS project
            ON project.id = schedule.project_v2_id
          WHERE schedule.next_poll_at <= now()
            AND (
              schedule.active_sync_run_id IS NULL
              OR (
                schedule.lease_expires_at < now()
                AND NOT EXISTS (
                  SELECT 1
                  FROM github_sync_jobs AS active_job
                  WHERE active_job.sync_run_id = schedule.active_sync_run_id
                    AND active_job.status IN ('queued', 'running')
                    AND active_job.lease_expires_at >= now()
                )
                AND (
                  (
                    EXISTS (
                      SELECT 1
                      FROM github_sync_runs AS active_run
                      WHERE active_run.id = schedule.active_sync_run_id
                        AND active_run.status IN ('queued', 'running')
                    )
                    AND (
                      NOT EXISTS (
                        SELECT 1
                        FROM github_sync_jobs AS active_job
                        WHERE active_job.sync_run_id = schedule.active_sync_run_id
                      )
                      OR EXISTS (
                        SELECT 1
                        FROM github_sync_jobs AS active_job
                        WHERE active_job.sync_run_id = schedule.active_sync_run_id
                          AND active_job.status IN ('queued', 'running')
                          AND (active_job.lease_expires_at IS NULL OR active_job.lease_expires_at < now())
                      )
                    )
                  )
                  OR NOT EXISTS (
                    SELECT 1
                    FROM github_sync_runs AS active_run
                    WHERE active_run.id = schedule.active_sync_run_id
                      AND active_run.status IN ('queued', 'running')
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM github_sync_jobs AS active_job
                    WHERE active_job.sync_run_id = schedule.active_sync_run_id
                      AND active_job.status IN ('success', 'failed')
                  )
                )
              )
            )
            AND project.owner_type = 'User'
          ORDER BY schedule.next_poll_at ASC, schedule.repository_id ASC, schedule.project_v2_id ASC
          LIMIT $1
          FOR UPDATE OF schedule SKIP LOCKED
        ),
        created_runs AS (
          INSERT INTO github_sync_runs (
            workspace_id,
            installation_id,
            repository_id,
            project_v2_id,
            target,
            status
          )
          SELECT
            schedule.workspace_id,
            schedule.installation_id,
            schedule.repository_id,
            schedule.project_v2_id,
            'project_v2_items',
            'queued'
          FROM candidate_schedules AS schedule
          WHERE schedule.reusable_sync_run_id IS NULL
          RETURNING id, repository_id, project_v2_id
        ),
        claimed_runs AS (
          SELECT
            schedule.reusable_sync_run_id AS sync_run_id,
            schedule.repository_id,
            schedule.project_v2_id,
            schedule.requested_by_user_id
          FROM candidate_schedules AS schedule
          WHERE schedule.reusable_sync_run_id IS NOT NULL

          UNION ALL

          SELECT
            created_run.id AS sync_run_id,
            schedule.repository_id,
            schedule.project_v2_id,
            schedule.requested_by_user_id
          FROM created_runs AS created_run
          INNER JOIN candidate_schedules AS schedule
            ON schedule.repository_id = created_run.repository_id
            AND schedule.project_v2_id = created_run.project_v2_id
        )
        UPDATE github_project_v2_polling_schedules AS schedule
        SET
          active_sync_run_id = claimed_run.sync_run_id,
          lease_owner = $2,
          lease_expires_at = now() + interval '10 minutes',
          updated_at = now()
        FROM claimed_runs AS claimed_run
        WHERE schedule.repository_id = claimed_run.repository_id
          AND schedule.project_v2_id = claimed_run.project_v2_id
        RETURNING
          claimed_run.sync_run_id,
          schedule.repository_id,
          schedule.project_v2_id,
          schedule.requested_by_user_id
      `,
      [limit, this.leaseOwner]
    );

    return rows.map((row) => ({
      syncRunId: row.sync_run_id,
      repositoryId: row.repository_id,
      projectV2Id: row.project_v2_id,
      requestedByUserId: row.requested_by_user_id
    }));
  }

  async markRunSucceeded(
    syncRunId: string,
    executor: GithubProjectV2PollingQueryExecutor = this.database
  ): Promise<void> {
    await executor.execute(
      `
        UPDATE github_project_v2_polling_schedules
        SET
          active_sync_run_id = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          next_poll_at = now() + interval '1 minute',
          failure_count = 0,
          last_error = NULL,
          updated_at = now()
        WHERE active_sync_run_id = $1
      `,
      [syncRunId]
    );
  }

  async markRunFailed(
    syncRunId: string,
    message: string,
    isRateLimited: boolean,
    executor: GithubProjectV2PollingQueryExecutor = this.database
  ): Promise<void> {
    const retryInterval = isRateLimited ? "30 minutes" : "5 minutes";
    await executor.execute(
      `
        UPDATE github_project_v2_polling_schedules
        SET
          active_sync_run_id = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          next_poll_at = now() + interval '${retryInterval}',
          failure_count = failure_count + 1,
          last_error = $2,
          updated_at = now()
        WHERE active_sync_run_id = $1
      `,
      [syncRunId, message.slice(0, 1000)]
    );
  }
}
