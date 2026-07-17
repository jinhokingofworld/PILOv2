# Google Calendar Secret Injection Design

## 목적

PILO dev App Server가 기존 AWS Secrets Manager의
`pilo-dev/app-server/GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`를 ECS 컨테이너 환경변수
`GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`로 받도록 복구한다. 기존 secret 값은 읽거나
교체하지 않으며, Google Calendar에 이미 저장된 토큰을 계속 복호화할 수 있어야 한다.

## 확인된 상태

- AWS 계정: `683655334891`, 리전: `ap-northeast-2`
- Secrets Manager secret과 `AWSCURRENT` 버전은 존재한다.
- 최신이자 현재 서비스가 사용하는 Task Definition은 `pilo-dev-app-server:19`이다.
- 해당 Task Definition의 `app-server` 컨테이너에는 Calendar 암호화 secret mapping이 없다.
- 최신 `origin/dev`의 Terraform은 Calendar secret을 생성 및 App Server에 주입하도록 선언한다.
- `infra/scripts/set-dev-external-secrets.ps1`에는 Calendar 암호화 키 입력 및 갱신 단계가 없다.

## 변경 설계

1. 인프라 회귀 테스트를 추가해 다음 계약을 고정한다.
   - Terraform App Server secret 목록에 `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`가 있다.
   - dev secret 입력 스크립트가 해당 값을 보안 입력으로 받고 정확한 Secrets Manager 경로에 전달한다.
2. `set-dev-external-secrets.ps1`에 Calendar 암호화 키 입력과
   `Put-SecretIfPresent` 호출을 추가한다. 빈 입력은 기존 secret을 덮어쓰지 않고 건너뛴다.
3. Terraform plan을 최신 `origin/dev` 기반 worktree에서 실행한다. 예상하지 않은 리소스 변경이
   포함되면 apply하지 않고 중단한다.
4. 예상 범위라면 Terraform을 적용해 새 App Server Task Definition을 등록하고 ECS 서비스가
   이를 사용하도록 롤링 배포한다.

## 보안 및 운영 제약

- secret plaintext를 명령 출력, Git, 문서, 테스트 fixture에 기록하지 않는다.
- 기존 `AWSCURRENT` 값을 유지하며 key rotation을 수행하지 않는다.
- AWS 작업은 사용자가 승인한 root console session profile로 수행한다.
- Terraform을 AWS 리소스의 source of truth로 유지하고 ECS Task Definition을 수동 등록하지 않는다.
- Google OAuth redirect URI 설정은 이번 변경 범위에 포함하지 않는다.

## 검증

- 회귀 테스트를 수정 전 실패, 수정 후 성공으로 확인한다.
- `terraform fmt -check -recursive`, `terraform validate`를 통과시킨다.
- 저장된 Terraform plan에서 예상 변경만 있는지 확인한다.
- 적용 후 ECS 서비스의 현재 Task Definition에 Calendar secret ARN mapping이 있는지 확인한다.
- ECS deployment가 `COMPLETED`, desired/running이 `1/1`인지 확인한다.
- App Server ALB target health와 CloudWatch startup log에서 배포 이상이 없는지 확인한다.

## 롤백

새 Task Definition 또는 배포가 실패하면 ECS 서비스를 직전 정상 Task Definition
`pilo-dev-app-server:19`로 되돌린다. secret 값은 변경하지 않으므로 secret data rollback은 필요하지 않다.
