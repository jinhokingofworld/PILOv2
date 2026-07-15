# PILO 개발환경 배포 체크리스트

## 1. 현재 단계

현재 단계는 dev 인프라와 CI/CD bootstrap을 마치고, 기능 개발 PR을 받을 수
있는지 최종 정리하는 단계다. 이 문서는 현재 레포와 실제 dev 환경에서 직접
확인 가능한 상태를 기준으로 유지한다.

현재 레포에서 확인된 작업:

- 현재 저장소 구조 확인
- 기존 GitHub Actions workflow 확인
- 개발환경 AWS 아키텍처 문서 작성
- Terraform 구현 계획 문서 작성
- secret/environment variable 목록 작성
- 배포 체크리스트 작성
- `infra/` Terraform module 뼈대 생성
- PILO 전용 GitHub Actions workflow 초안 생성
- `Project_Planning_Document.md` 기준 MVP 범위 확정
- `realtime-server`를 MVP 인프라 서비스로 유지하기로 결정
- LiveKit self-hosting, audio-only Egress, S3 녹음 저장 방향 확정
- EC2 + Docker Compose 기반 LiveKit host config 템플릿 추가
- Terraform LiveKit EC2, security group, IAM instance profile, EIP 리소스 추가
- LiveKit EC2 apply 완료
- `livekit.dev.pilo.my`, `turn.dev.pilo.my` DNS A record 연결
- LiveKit Server, Redis, Egress, Caddy Docker Compose 배포
- 외부 연동 secret 입력용 PowerShell 스크립트 작성
- Secrets Manager `pilo-dev/*` secret value 입력
- `apps/frontend`, `apps/app-server`, `apps/realtime-server`, `apps/ai-worker` scaffold 작성
- 각 서비스 CI script와 Dockerfile 경로 정렬
- GitHub Actions repository variables 등록
- GitHub Actions workflow 활성화
- `main` branch protection 설정
- CodeRabbit repo config 제거

검증된 외부 상태:

- AWS account `683655334891`, region `ap-northeast-2`
- Terraform CLI 설치 및 dev remote backend 연결
- `terraform fmt -check -recursive`, `terraform validate`, `terraform plan`
  통과
- Terraform plan 결과: `No changes`
- ECS `app-server`, `realtime-server`, `ai-worker`, `agent-worker` desired/running `1/1`
- App Server, Realtime Server ALB target health `healthy`
- Frontend CloudFront endpoint `200 OK`
- LiveKit HTTPS endpoint `https://livekit.dev.pilo.my` `200 OK`
- LiveKit DNS:
  - `livekit.dev.pilo.my -> 15.165.6.21`
  - `turn.dev.pilo.my -> 15.165.6.21`
- Secrets Manager `pilo-dev/*` secret들이 `AWSCURRENT` version 보유
- Supabase `PILO-Project` shared DB migration 001~004 적용

아직 하지 않은 작업:

- 첫 기능 PR에서 GitHub Actions required checks 실제 통과 확인
- GitHub App/OAuth, Kanban, PR 리뷰, 회의, 캔버스, 캘린더 기능 구현
- 도메인별 RLS policy가 필요한 시점에 새 DB migration 추가
- 실제 애플리케이션 기능 구현
- App Server의 LiveKit room/token/Egress start-stop API 구현
- AI Worker의 PR analysis와 meeting STT/report job 구현
- 필요 시 frontend/API 커스텀 dev 도메인 연결

## 2. 사전 준비

PR Review 전용 Worker는 기존 AWS 서비스에 영향을 주지 않도록 다음 순서로 활성화한다.

1. 최초 전용 Worker를 도입할 때만 `pr_review_ai_worker_desired_count = 0` 상태로 전용 SQS/DLQ와 ECS service 정의를 먼저 적용한다. 정상 운영 중인 dev의 기본값은 `1`이다.
2. App Server와 Worker task definition에 기존 shared handoff secret이 주입됐는지 확인한다.
3. repository variable `ECS_PR_REVIEW_AI_WORKER_SERVICE`를 등록한다.
4. `pr_review_ai_worker_desired_count = 1`로 적용하고 AI Worker workflow를 수동 실행한다.

Agent 전용 Worker는 legacy shared queue drain을 보존한 상태로 다음 순서로 전환한다.

1. `legacy_agent_drain_enabled = true`로 전용 SQS/DLQ와 `agent-worker` ECS service를 먼저 적용한다.
2. App Server task definition에 `SQS_AGENT_JOBS_QUEUE_URL`이 주입됐는지 확인한다.
3. repository variable `ECS_AGENT_WORKER_SERVICE`를 등록하고 AI Worker workflow를 실행한다.
4. `ai-jobs`의 기존 Agent message drain이 완료된 뒤에만 `legacy_agent_drain_enabled = false`로 적용한다.

### AWS 계정 준비

- AWS account id 확인
- region은 `ap-northeast-2` 사용
- Terraform state 저장용 S3 bucket은 기존 `pilo-dev-683655334891-terraform-state`를 사용
- Terraform state key는 기존 `infra/dev/terraform.tfstate`를 사용
- Terraform lock은 기존 state bucket의 S3 lockfile 방식을 사용한다
- remote backend bucket/state object는 기존 PILO dev 리소스를 사용한다

### 도메인 준비

- 실제 dev domain 결정
- Route53 hosted zone 준비
- CloudFront용 ACM certificate를 `us-east-1`에서 만들 계획 확인
- ALB용 ACM certificate를 `ap-northeast-2`에서 만들 계획 확인

### GitHub 준비

- GitHub repository owner/name은 `Developer-EJ/PILO`로 확인됨
- GitHub Actions OIDC 사용
- 배포 workflow:
  - `.github/workflows/deploy-frontend.yml`
  - `.github/workflows/deploy-app-server.yml`
  - `.github/workflows/deploy-realtime-server.yml`
  - `.github/workflows/deploy-ai-worker.yml`
- PR 검증 workflow:
  - `.github/workflows/app-ci.yml`
  - `.github/workflows/docker-ci.yml`
  - `.github/workflows/security-ci.yml`
  - `.github/workflows/terraform-validate.yml`

### 애플리케이션 소스 구조 결정

제안 구조:

```text
apps/frontend/
apps/app-server/
apps/realtime-server/
apps/ai-worker/
```

`apps/realtime-server/`는 유지한다. 단, MVP 역할은 앱 레벨 realtime notification/status delivery와 health check로 제한하고, LiveKit 음성 회의나 자유형 캔버스 동시 편집을 담당하지 않는다.

각 서비스별 Dockerfile 경로는 현재 workflow와 정렬되어 있다.

### LiveKit host 준비

MVP LiveKit은 EC2 한 대에서 Docker Compose로 LiveKit Server, LiveKit Redis,
LiveKit Egress, Caddy를 함께 실행하는 방향으로 둔다. 설정 템플릿은
`infra/livekit/`에 있으며 실제 secret이 들어가는 `.env`, `livekit.yaml`,
`egress.yaml`, `Caddyfile`은 commit하지 않는다.

현재 dev 환경에서는 Terraform으로 LiveKit EC2, security group, IAM instance
profile, EIP를 생성했고, DNS record는 `livekit.dev.pilo.my`와
`turn.dev.pilo.my`가 EC2 EIP를 가리킨다. 실제 secret이 들어가는 host-only
파일은 git에 commit하지 않는다.

## 3. Terraform 작성 후 검증 순서

Terraform 파일과 backend 값을 새 PILO 레포 기준으로 정리한 뒤 다음 순서로 검증한다.

1. Terraform formatting

```bash
terraform fmt -recursive
```

2. Terraform init

```bash
cd infra/envs/dev
terraform init
```

3. Terraform validate

```bash
terraform validate
```

4. Terraform plan

```bash
terraform plan
```

5. plan 검토

- NAT Gateway가 생성되지 않는지 확인
- RDS가 public으로 노출되지 않는지 확인
- Redis가 public으로 노출되지 않는지 확인
- ECS task가 dev에서 Public Subnet과 `assign_public_ip = true`를 사용하는지 확인
- AI Worker에 ALB target group이 붙지 않는지 확인
- secret value가 Terraform plan에 노출되지 않는지 확인

6. 사용자 승인 후에만 apply

```bash
terraform apply
```

## 4. 인프라 생성 순서

권장 순서:

1. network
2. security groups
3. iam
4. ecr
5. s3
6. sqs
7. rds
8. redis
9. alb
10. ecs
11. route53/acm
12. cloudfront
13. GitHub Actions

## 5. 배포 후 확인

### 네트워크

- ALB DNS 접속 가능 여부 확인
- ALB health check 통과 여부 확인
- ECS service desired/running count 확인
- Public Subnet ECS task에 public IP가 할당되었는지 확인
- RDS public accessibility가 false인지 확인
- Redis endpoint가 private subnet에 있는지 확인

### 로그

- App Server CloudWatch log stream 생성 확인
- Realtime Server CloudWatch log stream 생성 확인
- AI Worker CloudWatch log stream 생성 확인
- Meeting Worker CloudWatch log stream 생성 확인
- PR Review AI Worker CloudWatch log stream 생성 확인
- task startup error 확인

### 데이터 연결

- App Server에서 RDS 연결 확인
- App Server에서 Redis 연결 확인
- AI Worker에서 SQS consume 가능 여부 확인
- Meeting Worker에서 MeetingReport 전용 SQS consume 가능 여부 확인
- PR Review AI Worker에서 전용 SQS consume 가능 여부 확인
- AI Worker에서 S3 read/write 가능 여부 확인

### 외부 연동

- OpenAI API secret 조회 가능 여부 확인
- GitHub webhook 수신 가능 여부 확인
- LiveKit Server 접속 가능 여부 확인
- LiveKit room token 발급 가능 여부 확인
- LiveKit Egress가 같은 Redis와 LiveKit Server에 연결되는지 확인
- audio-only Egress 녹음 파일이 S3에 저장되는지 확인
- 저장된 오디오 파일로 Meeting Worker STT job 생성이 가능한지 확인

## 6. GitHub Actions 검증

### Terraform validation workflow

- pull request에서 `terraform fmt` 실행
- pull request에서 `terraform validate` 실행
- `AWS_TERRAFORM_PLAN_ROLE_ARN`이 설정된 동일 저장소 PR에서만 전용 read-only role로 remote backend `terraform plan`을 실행한다. 외부 fork PR은 role을 assume하지 못하고 fmt/validate만 실행한다.
- main push와 main branch의 `workflow_dispatch`도 같은 전용 plan role로 `terraform plan`을 실행한다.
- 기존 `AWS_GITHUB_ACTIONS_ROLE_ARN`은 배포 전용 고권한 role이며, PR plan에 사용하거나 OIDC trust를 PR까지 확장하지 않는다.
- plan 실행에서 OIDC assume role 성공과 remote backend 연결을 확인한다.

### PR Terraform plan 최초 활성화

1. main에서 Terraform 변경을 승인·apply한다.
2. `terraform -chdir=infra/envs/dev output -raw terraform_plan_role_arn`으로 전용 role ARN을 확인한다.
3. GitHub repository variable `AWS_TERRAFORM_PLAN_ROLE_ARN`에 위 ARN을 등록한다.
4. 동일 저장소에서 `infra/**` 또는 Terraform workflow를 변경한 PR을 열어 `Terraform Validate / plan`이 remote state 기준으로 성공하는지 확인한다.

role에는 state object read와 lockfile 생성·해제, 현재 Terraform state refresh에 필요한 명시적 읽기 권한만 부여한다. 여기에는 CloudFront function, VPC attribute, S3 lifecycle·encryption·object lock 설정, DynamoDB 연속 백업·TTL 상태, Secrets Manager resource policy 조회가 포함되며, secret value read, 리소스 변경, IAM 변경은 허용하지 않는다.

현재 dev refresh의 84개 관측 action은 `infra/tests/fixtures/terraform-plan-refresh-actions.json`으로 계약 검증한다. AWS provider 버전 변경, 새 AWS resource 추가, 새 provider alias 추가, 또는 plan role `AccessDenied`가 발생하면 [Terraform plan role refresh 감사](terraform-plan-role-refresh-audit.md)를 다시 수행한 뒤 allowlist와 inventory를 같은 PR에서 갱신한다.

### App Server workflow

- Docker build 성공
- ECR push 성공
- ECS service deployment 시작 확인
- ALB health check 통과 확인

### Realtime Server workflow

- Docker build 성공
- ECR push 성공
- ECS service deployment 시작 확인
- WebSocket path health check 확인

### AI Worker workflow

- Docker build 성공
- ECR push 성공
- ECS service deployment 시작 확인
- SQS consume log 확인
- `ai-worker`, `agent-worker`, `meeting-worker`, `pr-review-ai-worker` ECS service가 같은 새 image로 안정화되는지 확인

### Frontend workflow

- Next.js static build 성공
- S3 sync 성공
- CloudFront invalidation 성공
- frontend domain 접속 확인

## 7. 비용 체크

개발환경 비용 최소화 확인:

- NAT Gateway 없음
- RDS dev용 작은 instance class 사용
- Redis single node 사용
- ECS desired count 최소화
- CloudWatch log retention 짧게 설정
- ECR lifecycle policy 적용
- S3 lifecycle rule 검토
- 불필요한 Multi-AZ 비활성화

## 8. 롤백 기준

배포 실패 시:

1. ECS deployment event 확인
2. CloudWatch Logs 확인
3. 이전 ECR image tag로 ECS service update. 단, schema compatibility migration이 포함된
   배포는 해당 도메인 운영 문서의 rollback 경계를 먼저 확인한다. 예를 들어 Meeting
   participant session migration 072 적용 뒤에는 session-compatible App Server revision보다
   이전 image를 rollback 대상으로 선택하지 않는다.
4. 필요 시 Terraform 변경 revert
5. DB migration이 포함된 경우 migration rollback 전략 별도 확인

## 9. 승인 필요 작업

다음 작업은 사용자 승인 후 진행한다.

- 추가 AWS 리소스 생성 또는 변경
- 비용 발생 리소스 중지 또는 삭제
- Terraform state remote backend 전환
