# Google Calendar Secret Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Google Calendar token encryption secret을 변경하지 않고 PILO dev App Server ECS 컨테이너에 주입한다.

**Architecture:** Terraform의 기존 `module.secrets.app_server_ecs_secrets` 출력을 App Server Task Definition의 `secrets`로 유지하고, 운영 입력 스크립트의 누락만 보완한다. Terraform plan이 예상한 App Server Task Definition 교체와 ECS 서비스 갱신만 포함할 때 apply하고, AWS에서 새 revision의 secret mapping과 안정 상태를 다시 조회한다.

**Tech Stack:** PowerShell, Node.js built-in test runner, Terraform, AWS Secrets Manager, AWS ECS Fargate, AWS CLI

## Global Constraints

- AWS 계정은 `683655334891`, 리전은 `ap-northeast-2`, CLI profile은 `new-profile-name`이다.
- `pilo-dev/app-server/GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`의 plaintext와 현재 값은 조회하거나 변경하지 않는다.
- Terraform을 source of truth로 유지하고 ECS Task Definition을 수동 등록하지 않는다.
- 예상하지 않은 Terraform 변경이 있으면 apply하지 않는다.
- Google OAuth redirect URI는 변경하지 않는다.

---

### Task 1: Secret provisioning 회귀 테스트와 스크립트 보완

**Files:**
- Create: `infra/tests/google-calendar-secret-injection.test.mjs`
- Modify: `infra/scripts/set-dev-external-secrets.ps1`

**Interfaces:**
- Consumes: `infra/modules/secrets/main.tf`의 `app_server_ecs_secret_names`와 `infra/scripts/set-dev-external-secrets.ps1`의 `Read-OptionalSecureText`, `Put-SecretIfPresent`
- Produces: `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` 보안 입력과 `pilo-dev/app-server/GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` 갱신 경로

- [ ] **Step 1: 실패하는 회귀 테스트 작성**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [secretsModule, secretScript] = await Promise.all([
  readFile(new URL("../modules/secrets/main.tf", import.meta.url), "utf8"),
  readFile(new URL("../scripts/set-dev-external-secrets.ps1", import.meta.url), "utf8")
]);

assert.match(secretsModule, /"GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"/);
assert.match(
  secretScript,
  /\$googleCalendarTokenEncryptionKey\s*=\s*Read-OptionalSecureText\s+"GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"/
);
assert.match(
  secretScript,
  /Put-SecretIfPresent\s+"pilo-dev\/app-server\/GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"\s+\$googleCalendarTokenEncryptionKey/
);

console.log("Google Calendar secret injection infrastructure is verified.");
```

- [ ] **Step 2: 테스트가 스크립트 누락으로 실패하는지 확인**

Run: `node --test infra/tests/google-calendar-secret-injection.test.mjs`

Expected: FAIL because `$googleCalendarTokenEncryptionKey` input and `Put-SecretIfPresent` call do not exist.

- [ ] **Step 3: 최소 스크립트 변경 적용**

`$googleOAuthClientSecret` 다음에 다음 입력을 추가한다.

```powershell
$googleCalendarTokenEncryptionKey = Read-OptionalSecureText "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"
```

Google OAuth secret 저장 다음에 다음 호출을 추가한다.

```powershell
Put-SecretIfPresent "pilo-dev/app-server/GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY" $googleCalendarTokenEncryptionKey
```

- [ ] **Step 4: 회귀 테스트와 전체 인프라 테스트 실행**

Run: `node --test infra/tests/google-calendar-secret-injection.test.mjs`

Expected: PASS with `Google Calendar secret injection infrastructure is verified.`

Run: `node --test infra/tests/*.test.mjs`

Expected: 6 tests, 6 pass, 0 fail.

- [ ] **Step 5: 구현 커밋 생성**

```powershell
git add infra/tests/google-calendar-secret-injection.test.mjs infra/scripts/set-dev-external-secrets.ps1
git commit -m "fix: Google Calendar secret 주입 경로 보완 (#1317)"
```

### Task 2: Terraform 계획 검증과 적용

**Files:**
- Verify: `infra/envs/dev/main.tf`
- Verify: `infra/modules/secrets/main.tf`
- Verify: `infra/modules/secrets/outputs.tf`
- Generated locally and never committed: `infra/envs/dev/calendar-secret.tfplan`

**Interfaces:**
- Consumes: `module.secrets.app_server_ecs_secrets`
- Produces: `app-server` 컨테이너의 `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` secret ARN mapping과 새 ECS Task Definition revision

- [ ] **Step 1: Terraform 형식 검증**

Run: `terraform fmt -check -recursive infra`

Expected: exit code 0 with no changed files.

- [ ] **Step 2: 원격 backend 초기화와 구성 검증**

```powershell
$env:AWS_PROFILE = "new-profile-name"
terraform -chdir=infra/envs/dev init -input=false
terraform -chdir=infra/envs/dev validate
```

Expected: backend initialization succeeds and validate reports `Success! The configuration is valid.`

- [ ] **Step 3: 저장된 plan 생성**

Run: `terraform -chdir=infra/envs/dev plan -input=false -no-color -out=calendar-secret.tfplan`

Expected: App Server Task Definition replacement and ECS service task definition update are present. Secret value/version changes, resource deletion, DB/network changes are absent.

- [ ] **Step 4: plan 내용을 사람이 읽을 수 있는 형태로 재검증**

Run: `terraform -chdir=infra/envs/dev show -no-color calendar-secret.tfplan`

Expected: `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` ARN mapping is added to `app-server`; no plaintext secret appears. Any unrelated change stops execution before apply.

- [ ] **Step 5: 저장된 plan 적용**

Run: `terraform -chdir=infra/envs/dev apply -input=false -auto-approve calendar-secret.tfplan`

Expected: apply succeeds, a new `pilo-dev-app-server` Task Definition revision is registered, and ECS service points to it.

### Task 3: AWS 배포 및 서비스 검증

**Files:**
- No repository files modified.

**Interfaces:**
- Consumes: ECS cluster `pilo-dev-cluster`, service `pilo-dev-app-server`, secret path `pilo-dev/app-server/GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`
- Produces: 검증된 stable App Server deployment

- [ ] **Step 1: ECS 서비스 안정 상태 대기**

Run: `aws ecs wait services-stable --cluster pilo-dev-cluster --services pilo-dev-app-server --region ap-northeast-2 --profile new-profile-name`

Expected: exit code 0.

- [ ] **Step 2: 현재 Task Definition의 secret mapping 확인**

```powershell
$taskDefArn = aws ecs describe-services --cluster pilo-dev-cluster --services pilo-dev-app-server --region ap-northeast-2 --profile new-profile-name --query "services[0].taskDefinition" --output text
aws ecs describe-task-definition --task-definition $taskDefArn --region ap-northeast-2 --profile new-profile-name --query "taskDefinition.containerDefinitions[?name=='app-server'].secrets[?name=='GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY'].{name:name,valueFrom:valueFrom}" --output json
```

Expected: one mapping whose `name` is `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` and whose `valueFrom` references the existing secret ARN.

- [ ] **Step 3: 배포 수와 rollout 상태 확인**

Run: `aws ecs describe-services --cluster pilo-dev-cluster --services pilo-dev-app-server --region ap-northeast-2 --profile new-profile-name --query "services[0].{Desired:desiredCount,Running:runningCount,Deployments:deployments[].{status:status,rolloutState:rolloutState,failed:failedTasks}}" --output json`

Expected: desired/running `1/1`, PRIMARY rollout `COMPLETED`, failed tasks `0`.

- [ ] **Step 4: ALB target health와 공개 health endpoint 확인**

```powershell
$targetGroupArn = aws ecs describe-services --cluster pilo-dev-cluster --services pilo-dev-app-server --region ap-northeast-2 --profile new-profile-name --query "services[0].loadBalancers[0].targetGroupArn" --output text
aws elbv2 describe-target-health --target-group-arn $targetGroupArn --region ap-northeast-2 --profile new-profile-name --query "TargetHealthDescriptions[].TargetHealth.State" --output json
Invoke-WebRequest -UseBasicParsing https://api.dev.pilo.my/api/v1/health
```

Expected: target state `healthy` and HTTP status `200`.

- [ ] **Step 5: 최종 repository 및 secret 불변성 확인**

```powershell
git status --short
aws secretsmanager describe-secret --secret-id pilo-dev/app-server/GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY --region ap-northeast-2 --profile new-profile-name --query "{Name:Name,VersionIdsToStages:VersionIdsToStages}" --output json
```

Expected: tracked files are clean except the intentionally untracked plan file, and the secret still has an `AWSCURRENT` version without reading plaintext.
