# GitHub Sync Operations

`github-sync-worker` is the single worker for GitHub webhook deliveries and durable sync jobs. This runbook covers dev monitoring and human recovery. It does not introduce a second event worker, autoscaling, or a new queue.

## Metrics and alarms

CloudWatch uses `/ecs/${name_prefix}/github-sync-worker` and existing SQS/ECS metrics. SQS age and backlog alarms evaluate in one-minute periods; operation metrics evaluate in five-minute periods. Missing SQS or operation data is not breaching. Missing worker `RunningTaskCount` is breaching.

| Target | Metric | Warning | Critical | Meaning |
| --- | --- | ---: | ---: | --- |
| `github-webhooks` | oldest message age | 60s | 300s | Webhook processing is behind user changes. |
| `github-webhooks` | visible backlog | 20 | 100 | Webhook messages are accumulating. |
| `github-sync-jobs` | oldest message age | 600s | 1800s | Durable sync-job processing is delayed. |
| `github-sync-jobs` | visible backlog | 10 | 50 | Sync jobs are accumulating. |
| `github-webhooks-dlq` | visible backlog | 1 | 10 | Webhook delivery failures are isolated. |
| `github-sync-jobs-dlq` | visible backlog | 1 | 10 | Sync-job failures are isolated. |
| `github-sync-worker` | ECS `RunningTaskCount` below 1 | 2 minutes | 5 minutes | Worker tasks are not staying healthy. |
| operation logs | `RetryCount` | 5 | 20 | Retries are concentrated in five minutes. |
| operation logs | `TerminalFailureCount` | 1 | 5 | Terminal failures occurred in five minutes. |
| operation logs | `RateLimitRemaining` | 100 | 0 | GitHub GraphQL quota is low or exhausted. |

`RetryCount` is produced by `github_sync_retry`. `TerminalFailureCount` is produced by `github_sync_terminal_failure` and `github_sync_rate_limit_terminal_failure`. `RateLimitRemaining` is produced by numeric `github_sync_rate_limit_observed` events from successful GraphQL responses, so it is a pre-exhaustion signal rather than only a terminal-failure signal. Critical requires immediate human investigation; Warning requires trend and worker-health confirmation.

Consider a separate event worker or autoscaling only after worker health is confirmed and either of these is true:

- A 15-minute window has webhook critical age or backlog.
- backlog-per-running-worker exceeds 100.

## Structured operation logs

The worker writes one raw JSON event per stdout line so CloudWatch JSON filters can read it. Event names are:

- `github_sync_retry`
- `github_sync_terminal_failure`
- `github_sync_rate_limit_terminal_failure`
- `github_sync_rate_limit_observed`

Every event contains `event`, `jobId`, `syncRunId`, `deliveryId`, `target`, `attemptCount`, and nullable `rateLimitRemaining`. Job events retain `deliveryId: null`. Retry events include `retryAfterSeconds` when known: 900 seconds for a sync job and 120 seconds for a webhook delivery. A webhook retry records its `deliveryId` and can have null `jobId`, `syncRunId`, and `attemptCount`. A successful GraphQL response with a numeric `x-ratelimit-remaining` header emits `github_sync_rate_limit_observed`; its identifiers are null and its target is `graphql`.

Never log access tokens, webhook payloads, provider raw errors, or secrets. Use event identifiers and DB state for investigation; do not add credentials or payloads to logs or incident evidence.

## DLQ recovery procedure

DLQ redrive is performed only by an authorized operator. It must not be run automatically by the worker, because repeated failures and mass reprocessing can be amplified.

1. Identify the failing queue or DLQ from CloudWatch, then identify the `jobId` or `deliveryId` and the corresponding `github_sync_jobs`/`github_sync_runs` or `github_webhook_deliveries` terminal state.
2. Correct the cause first: deploy or roll back code, repair queue publishing, reconnect a credential, restore permission, or wait for the GitHub rate-limit reset.
3. The authorized operator manually redrives a bounded sample. Select a small representative sample; never redrive the whole DLQ first.
4. Confirm queue oldest age and visible backlog, worker raw JSON logs, CloudWatch metrics, and DB run/delivery terminal state for the sample.
5. Only after the sample is healthy, the authorized operator manually redrives the remainder. If failures recur, preserve the remainder and return to investigation.

Do not change queue behavior during redrive: webhook visibility remains 120 seconds, sync-job visibility remains 900 seconds, and SQS redrive max receive count remains 3.

## Incident response paths

### Worker stopped

For `RunningTaskCount` Warning or Critical, inspect ECS service events and task stopped reasons. Correct image, task-role, network, or secret injection issues, then confirm at least one worker task is running. Do not classify backlog as a scaling issue before worker health is confirmed.

### Failed queue publish

For webhook or sync-job publish failure, inspect the application log and durable DB delivery/run state. Correct SQS endpoint, queue URL, task-role permission, or AWS availability first, then confirm persisted delivery/job recovery can publish again. Do not redrive a DLQ before its publish cause is fixed.

### DLQ alarm

For DLQ backlog of 1 or more, follow the DLQ recovery procedure. At Critical 10, pause further redrive, classify the failure causes and sample results, then escalate to the responsible operator.

### GitHub credential revoked

For revoked or invalid GitHub App/OAuth credentials, verify the workspace installation, OAuth connection, required project scope, and permissions, then reconnect. Do not copy credentials into logs or tickets. Verify the repaired permission path with a bounded sample before redriving the remainder.

### GitHub rate limit

At `RateLimitRemaining` Warning from `github_sync_rate_limit_observed`, check remaining budget and request patterns before exhaustion. At Critical 0 or `github_sync_rate_limit_terminal_failure`, do not increase GraphQL traffic: wait for GitHub reset/backoff. A polling rate-limit failure schedules a retry after 30 minutes; do not immediately redrive an entire DLQ. After quota recovers, verify a bounded sample and DB terminal state.

## Dev smoke checklist

After deployment or worker changes, collect evidence for both dev flows:

1. Run one successful sync. Confirm CloudWatch queue age/backlog returns to normal, the ECS task is healthy, worker raw JSON logs are safe, and `github_sync_runs`/`github_sync_jobs` reach `success` terminal state.
2. Cause one safe retryable failure. Confirm `github_sync_retry`, `retryAfterSeconds`, CloudWatch `RetryCount`, queue age/backlog, and that the DB run/job did not incorrectly become terminal before retry.

Do not use a real credential revoke, actual rate-limit exhaustion, or a bulk dev/production DLQ redrive as a smoke test. In both flows, retain logs, CloudWatch observations, and DB-state evidence without access tokens, webhook payloads, provider raw errors, or secrets.

## LocalStack queue configuration verification

After starting LocalStack through Docker Compose or running `infra/scripts/create-local-sqs-queues.ps1`, verify both GitHub queues before testing a worker flow. `pilo-dev-github-webhooks` must have `VisibilityTimeout` `120` and `pilo-dev-github-sync-jobs` must have `VisibilityTimeout` `900`. Both queues must have a `RedrivePolicy` that targets their matching `-dlq` queue with `maxReceiveCount` `3`.

```bash
awslocal sqs get-queue-attributes --queue-url "$(awslocal sqs get-queue-url --queue-name pilo-dev-github-webhooks --query QueueUrl --output text)" --attribute-names VisibilityTimeout RedrivePolicy
awslocal sqs get-queue-attributes --queue-url "$(awslocal sqs get-queue-url --queue-name pilo-dev-github-sync-jobs --query QueueUrl --output text)" --attribute-names VisibilityTimeout RedrivePolicy
```

For a PowerShell-created LocalStack instance, replace `awslocal sqs` with `aws --endpoint-url $env:SQS_ENDPOINT sqs` and use the same queue names and attributes. Do not change these attributes while redriving a DLQ.

### Manual isolated integration test

`infra/tests/github-sync-localstack-config.test.mjs` is intentionally not wired into a common test runner or CI. It starts separate disposable `localstack/localstack:3` containers with anonymous port mappings, runs the shell and PowerShell setup paths independently, and removes the containers afterward. It never uses the `pilo_localstack_data` Docker volume or an AWS account.

Prerequisites: Docker Desktop must be running and able to pull `localstack/localstack:3`; Node.js, Windows PowerShell, and AWS CLI must be available. The test supplies only a LocalStack endpoint and test credentials to the PowerShell setup path; it does not use AWS account credentials or an AWS endpoint.

Run it manually from the repository root:

```powershell
$env:RUN_LOCALSTACK_INTEGRATION=1
node infra/tests/github-sync-localstack-config.test.mjs
```

The test verifies `VisibilityTimeout`, `RedrivePolicy`, matching DLQ ARN, and `maxReceiveCount` `3` for both `pilo-dev-github-webhooks` and `pilo-dev-github-sync-jobs` after each setup path.

## Cost scope

This work includes only these cost categories: worker count, public IPv4, CloudWatch logs/metrics/alarms, and SQS requests. It explicitly excludes scale-out and NAT. The single `github-sync-worker` remains in place until the future event-worker/autoscaling decision rule is met.
