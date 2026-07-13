# PILO 개발환경 AWS 아키텍처

## 1. 목적

PILO 개발환경 인프라는 비용을 최소화하면서도 실제 MVP 구조를 검증할 수 있도록 설계한다. 모든 AWS 리소스는 Terraform으로 관리하며, 콘솔에서 수동 생성한 리소스는 예외로 두지 않는다.

현재 저장소에는 `infra/`, `.github/`, 문서, 그리고 MVP 앱 scaffold가 존재한다.
실제 진행 상태는 `docs/infra/deploy-checklist.md`와 로컬 파일 구조를 함께 확인한다.

현재 dev 환경에서 확인된 주요 상태:

- Terraform dev remote backend 연결 완료
- Terraform plan 결과 `No changes`
- ECS `app-server`, `realtime-server`, `ai-worker` 서비스 running
- App Server와 Realtime Server ALB target health `healthy`
- Frontend CloudFront endpoint 응답 확인
- LiveKit self-host EC2 running
- `livekit.dev.pilo.my`, `turn.dev.pilo.my` DNS 연결

## 2. 기본 원칙

- AWS region은 `ap-northeast-2`를 사용한다.
- 개발환경에서는 NAT Gateway를 만들지 않는다.
- ECS Fargate task는 Public Subnet에서 실행하고 `assign_public_ip = true`를 사용한다.
- RDS PostgreSQL과 ElastiCache Redis는 Private Subnet에 둔다.
- RDS와 Redis는 public 접근을 허용하지 않는다.
- App Server와 Realtime Server의 inbound traffic은 ALB security group에서만 허용한다.
- AI Worker는 인터넷 inbound를 받지 않고 outbound만 사용한다.
- API key, DB password, GitHub private key, LiveKit secret은 Terraform 파일에 하드코딩하지 않는다.
- 비밀값은 AWS Secrets Manager 또는 SSM Parameter Store 참조로 관리한다.
- ECS 로그는 CloudWatch Logs로 수집한다.
- 음성 회의는 MVP에서 LiveKit을 self-hosting한다.
- MVP에서는 LiveKit Server, LiveKit Redis, LiveKit Egress를 같은 EC2 또는 같은 ECS 배포 단위에 둔다.
- 회의 녹음은 영상 녹화가 아니라 audio-only Egress로 S3에 저장한다.
- 운영 안정화 후 Egress만 별도 EC2 또는 ECS service로 분리한다.
- `realtime-server`는 LiveKit을 대체하지 않는다. 앱 내부 이벤트 전달과 향후 실시간 확장을 위한 별도 서비스로 유지한다.
- MVP에서 자유형 캔버스 CRDT, 커서 공유, 하트비트, 채팅, MeetingRoom 관리는 구현하지 않는다.

## 3. 서비스 구성

### Frontend

- 기술: Next.js
- 개발환경 배포 선호안: 정적 export가 가능하면 S3 + CloudFront
- HTTPS와 커스텀 도메인: Route53 + ACM
- 예시 도메인: `dev.pilo.example.com`
- 실제 도메인은 Terraform variable로 주입한다.

### App Server

- 기술: NestJS
- 실행: ECS Fargate
- 역할:
  - Google/GitHub 소셜 로그인 및 세션 인증
  - Workspace 경계와 접근 제어
  - GitHub App installation, 사용자 GitHub OAuth 연결
  - Repository, Issue, Pull Request, ProjectV2 동기화 API
  - Kanban board hydrate와 ProjectV2 status 이동 API
  - PR review session, file decision, submission API
  - 자유형 캔버스와 캘린더 CRUD API
  - LiveKit room token 발급과 audio-only Egress 시작/종료
  - AI job 생성
- inbound:
  - ALB에서 오는 `/api/v1`, `/api/v1/*` traffic만 허용
- outbound:
  - RDS, Redis, S3, SQS, Secrets Manager, GitHub, LiveKit Server 접근

### Realtime Server

- 기술: WebSocket 서버
- 실행: ECS Fargate
- 역할:
  - 앱 레벨 realtime notification
  - sync run, AI analysis, meeting report processing 같은 진행 상태 전달
  - 프론트엔드 reconnect와 health check 검증
  - 향후 캔버스 협업, presence, 알림 확장 지점 유지
- MVP에서 하지 않는 역할:
  - LiveKit 음성 송수신
  - 자유형 캔버스 CRDT/동시 편집
  - 커서 공유와 하트비트
  - 채팅
  - MeetingRoom 관리
  - GitHub, PR 리뷰, 회의, 일정 데이터의 source of truth
- inbound:
  - ALB에서 오는 `/ws`, `/ws/*`, `/socket.io/*`, `/sync/*` traffic만 허용
- outbound:
  - Redis, RDS, S3 접근

### AI Worker Server

- 기술: FastAPI 기반 Python/LangGraph worker
- 실행: ECS Fargate
- 역할:
  - SQS message consume
  - OpenAI Responses API 호출
  - meeting report 생성
  - PR analysis 생성
  - review summary 생성
  - RDS/S3에 결과 저장
- inbound:
  - 인터넷 inbound 없음
- outbound:
  - SQS, RDS, S3, Secrets Manager, OpenAI API 접근

### Voice

- MVP에서는 LiveKit을 self-hosting한다.
- App Server가 LiveKit room token을 발급한다.
- App Server가 회의 시작/종료 흐름에서 audio-only Egress를 제어한다.
- Egress는 회의 전체 음성을 하나의 파일로 S3에 저장한다.
- AI Worker는 S3에 저장된 오디오 파일을 받아 STT와 회의록 생성을 수행한다.
- 발화자별 오디오 분리가 꼭 필요해지면 Track Egress로 확장한다.

MVP 배치:

```text
LiveKit host
├─ LiveKit Server
├─ LiveKit Redis
└─ LiveKit Egress
   └─ audio_only recording -> S3 recordings/uploads bucket
```

운영 안정화 후:

```text
LiveKit Server host/service
├─ LiveKit Server
└─ LiveKit Redis

LiveKit Egress host/service
└─ LiveKit Egress -> S3 recordings/uploads bucket
```

## 4. 네트워크 구조

개발환경 구조:

```text
VPC
├─ Public Subnet A
│  ├─ ALB
│  └─ ECS Fargate tasks
│     ├─ app-server
│     ├─ realtime-server
│     ├─ ai-worker
│     ├─ agent-worker
│     └─ pr-review-ai-worker
│
├─ Public Subnet B
│  ├─ ALB
│  └─ ECS Fargate tasks
│
├─ Private Subnet A
│  ├─ RDS PostgreSQL
│  └─ ElastiCache Redis
│
└─ Private Subnet B
   ├─ RDS PostgreSQL subnet group
   └─ ElastiCache Redis subnet group
```

개발환경에서 ECS task를 Public Subnet에 두는 이유는 NAT Gateway 없이도 다음 outbound가 필요하기 때문이다.

- ECR image pull
- CloudWatch Logs 전송
- Secrets Manager 또는 SSM Parameter Store 조회
- OpenAI API 호출
- GitHub API/Webhook 처리
- LiveKit Server/Egress API 호출

RDS와 Redis는 Private Subnet에 두고 security group으로 ECS task에서 오는 traffic만 허용한다.

## 5. Security Group 설계

### ALB Security Group

Inbound:

- `80/tcp` from `0.0.0.0/0`
- `443/tcp` from `0.0.0.0/0`

Outbound:

- App Server target port
- Realtime Server target port

### App Server Security Group

Inbound:

- App Server port from ALB security group

Outbound:

- PostgreSQL `5432/tcp`
- Redis `6379/tcp`
- HTTPS `443/tcp`
- SQS/S3/Secrets Manager endpoints via public internet in dev

### Realtime Server Security Group

Inbound:

- Realtime Server port from ALB security group

Outbound:

- PostgreSQL `5432/tcp`
- Redis `6379/tcp`
- HTTPS `443/tcp`

### AI Worker Security Group

Inbound:

- 없음

Outbound:

- PostgreSQL `5432/tcp`
- Redis `6379/tcp` if needed
- HTTPS `443/tcp`

### RDS Security Group

Inbound:

- `5432/tcp` from App Server security group
- `5432/tcp` from Realtime Server security group if needed
- `5432/tcp` from AI Worker security group

Outbound:

- 기본값 또는 최소화

### Redis Security Group

Inbound:

- `6379/tcp` from App Server security group
- `6379/tcp` from Realtime Server security group
- `6379/tcp` from AI Worker security group if needed

Outbound:

- 기본값 또는 최소화

## 6. ALB Routing

기본 routing:

```text
dev.pilo.example.com/*          -> frontend CloudFront/S3
api.dev.pilo.example.com/api/v1/* -> ALB -> App Server
api.dev.pilo.example.com/ws/*     -> ALB -> Realtime Server
api.dev.pilo.example.com/sync/* -> ALB -> Realtime Server
```

단일 도메인 path routing도 가능하다.

```text
dev.pilo.example.com            -> CloudFront
dev.pilo.example.com/api/v1/* -> ALB -> App Server
dev.pilo.example.com/ws/*     -> ALB -> Realtime Server
```

첫 구현에서는 CloudFront frontend와 ALB backend를 분리한 `dev`/`api.dev` 도메인 구조가 더 이해하기 쉽다. CloudFront가 ALB origin까지 함께 들고 가는 구조는 이후 필요할 때 확장한다.

## 7. 데이터 계층

### RDS PostgreSQL

- dev instance class는 비용 절감을 위해 작은 인스턴스를 사용한다.
- `publicly_accessible = false`
- subnet group은 Private Subnet만 포함한다.
- 초기에는 Multi-AZ를 끈다.
- deletion protection은 dev에서는 false로 둘 수 있으나, 실수 방지를 위해 변수화한다.
- Prisma migration은 애플리케이션 배포 파이프라인에서 별도 단계로 다루는 것을 권장한다.

### ElastiCache Redis

- Private Subnet에 배치한다.
- single node dev 구성을 우선한다.
- 용도:
  - realtime notification pub/sub
  - short-lived cache
  - AI job status cache if needed
- source of truth는 PostgreSQL이다.

### S3

두 종류의 bucket을 분리한다.

- frontend static bucket
- uploads/reports/snapshots bucket

uploads bucket은 public access block을 활성화하고, presigned URL 또는 backend proxy 방식으로 접근한다.
회의 녹음 파일도 같은 private uploads bucket 또는 별도 recordings prefix에 저장한다.

## 8. 비동기 작업 구조

SQS는 NestJS App Server와 AI Worker/GitHub Worker 사이의 비동기 작업 큐다.

기본 queue:

- `pilo-dev-ai-jobs`
- `pilo-dev-ai-jobs-dlq`
- `pilo-dev-pr-review-analysis`
- `pilo-dev-pr-review-analysis-dlq`
- `pilo-dev-github-webhooks`
- `pilo-dev-github-webhooks-dlq`
- `pilo-dev-github-sync-jobs`
- `pilo-dev-github-sync-jobs-dlq`

흐름:

```text
User -> Next.js -> App Server -> RDS job record 생성
                           └-> SQS message publish
AI Worker -> SQS message consume -> OpenAI/GitHub/S3/RDS 처리
AI Worker -> RDS result 저장 -> Realtime notification
```

회의 녹음과 회의록 생성 흐름:

```text
User -> Next.js -> App Server -> LiveKit room/token 발급
User -> Next.js -> App Server -> LiveKit Egress audio_only 녹음 시작
LiveKit Egress -> S3 recordings prefix에 오디오 저장
User -> Next.js -> App Server -> 녹음 종료 + SQS meeting report job 생성
AI Worker -> S3 오디오 다운로드 -> OpenAI STT -> OpenAI LLM 보고서 생성 -> RDS 저장
Frontend -> App Server -> RDS MeetingReport 상태 조회
```

## 9. CI/CD 개요

GitHub Actions는 OIDC 기반으로 AWS IAM Role을 assume한다. 장기 AWS access key를 GitHub Secrets에 저장하지 않는다.

필요 workflow:

- App CI
  - frontend, app-server, realtime-server, ai-worker format/lint/test/build
- Docker CI
  - app-server, realtime-server, ai-worker image build
- Security CI
  - gitleaks
  - pip-audit
- Terraform validation
  - `terraform fmt`
  - `terraform validate`
  - pull request에서는 `terraform fmt`와 `terraform validate`만 실행
  - `AWS_GITHUB_ACTIONS_ROLE_ARN`이 설정되고 workflow path filter(`infra/**` 또는 `.github/workflows/terraform-validate.yml`)에 일치하는 qualifying main push, 또는 main branch의 `workflow_dispatch` 수동 실행에서만 실행되는 `terraform plan`
- App Server image build/push/deploy
- Realtime Server image build/push/deploy
- AI Worker image build/push/deploy
- Frontend static build/upload/CloudFront invalidation

현재 저장소의 workflow:

- `.github/workflows/app-ci.yml`
- `.github/workflows/docker-ci.yml`
- `.github/workflows/security-ci.yml`
- `.github/workflows/terraform-validate.yml`
- `.github/workflows/deploy-frontend.yml`
- `.github/workflows/deploy-app-server.yml`
- `.github/workflows/deploy-realtime-server.yml`
- `.github/workflows/deploy-ai-worker.yml`

배포 workflow는 required PR check로 사용하지 않는다. PR에서는 CI required checks를
통과하고, `main` merge 이후 변경 경로에 맞는 배포 workflow가 실행된다.

## 10. Production 확장 고려

Terraform module은 dev와 prod를 variable로 분리할 수 있게 만든다.

prod 전환 시 바뀔 주요 값:

- ECS subnets: Public Subnet -> Private Subnet
- `assign_public_ip`: true -> false
- NAT Gateway 또는 VPC Endpoint 활성화
- RDS Multi-AZ 활성화
- Redis replication group 구성
- deletion protection 활성화
- CloudFront/ALB WAF 검토
- 로그 보존 기간 증가

현재 단계에서는 prod 리소스를 구현하지 않고, variable 구조만 prod 전환을 고려해 설계한다.
