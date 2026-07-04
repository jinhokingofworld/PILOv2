# New Repository Infra TODO

Before the first real deploy, update these values.

## Project Identity

- [x] Keep `pilo` / `PILO` as the project slug/name.
- [x] Keep ECR repositories:
  - `pilo-app-server`
  - `pilo-realtime-server`
  - `pilo-ai-worker`
- [x] Use `Developer-EJ/PILO` for GitHub OIDC settings.

## Terraform State

- [x] Edit `infra/envs/dev/backend.tf`.
- [x] Reuse the verified PILO dev S3 backend bucket/key.
- [x] Do not create or reuse another project's `terraform.tfstate`.
- [x] Keep `terraform.tfvars` uncommitted.

## Services

- [x] Keep the MVP services in the repo plan:
  - `frontend`
  - `app-server`
  - `realtime-server`
  - `ai-worker`
- [x] Keep `realtime-server` workflow and Terraform ECS service entry.
- [x] Treat `realtime-server` as the app-level realtime channel, not the LiveKit voice server.
- [x] Scope `realtime-server` MVP work to lightweight notifications/status delivery and health checks.
- [x] Do not put canvas CRDT, cursor sharing, heartbeat, chat, or MeetingRoom management in the MVP realtime scope.
- [x] Keep `ai-worker` for PR AI analysis and meeting STT/report jobs.
- [x] Do not implement Kanban AI agent or task suggestion jobs for MVP.
- [x] Restore or scaffold the expected `apps/` directories.
- [x] Ensure Dockerfile paths match the workflows.

## LiveKit Voice MVP

- [x] Use self-hosted LiveKit for MVP voice meetings.
- [x] Record audio only, not video/screen recordings.
- [x] Start with LiveKit Server, LiveKit Redis, and LiveKit Egress colocated on the same EC2 or ECS deployment unit.
- [x] Add LiveKit Server deployment config.
- [x] Add LiveKit Egress deployment config.
- [x] Store audio-only Egress files in S3.
- [x] Add LiveKit EC2 Terraform config.
- [x] Apply LiveKit EC2 Terraform resources after plan approval.
- [x] Add `livekit.dev.pilo.my` and `turn.dev.pilo.my` DNS A records.
- [x] Deploy LiveKit Docker Compose stack to EC2.
- [ ] Wire App Server room/token/egress start-stop APIs.
- [ ] Wire AI Worker STT and meeting report jobs from S3 recordings.
- [ ] Split Egress to a separate EC2/ECS service after MVP load requires it.

## CI Scripts

- [x] Node services expose `format:check`, `lint`, `test`, and `build`.
- [x] Python worker has `requirements.txt`, `requirements-dev.txt`, `black`, `ruff`, and `pytest`.
- [x] Update path filters in `.github/workflows/*.yml` if app paths change.
- [x] Remove CodeRabbit repository config.
- [x] Protect `main` with PR review and required GitHub Actions checks.
- [ ] Confirm the first bootstrap PR passes all required checks on GitHub Actions.

## Secrets And Variables

- [x] Put secret values in AWS Secrets Manager or GitHub Secrets, not in Git.
- [x] Register GitHub repository variables from Terraform outputs:
  - `AWS_GITHUB_ACTIONS_ROLE_ARN`
  - `ECS_CLUSTER_NAME`
  - `ECS_APP_SERVER_SERVICE`
  - `ECS_REALTIME_SERVER_SERVICE`
  - `ECS_AI_WORKER_SERVICE`
  - `FRONTEND_S3_BUCKET`
  - `CLOUDFRONT_DISTRIBUTION_ID`

## Local Development

- [x] Edit `.env.example`.
- [x] Edit `docker-compose.dev.yml`.
- [x] Add new project DB migration mounts only after the schema files exist.
- [x] Ignore TypeScript incremental build cache files.
