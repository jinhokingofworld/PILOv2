# PILO CI Policy

## Required checks

협업 PR은 아래 GitHub Actions check를 통과해야 merge할 수 있다.
Required check가 PR 종류별로 누락되지 않도록 CI workflow에는 path filter를 두지 않는다.

- `frontend`
- `app-server`
- `realtime-server`
- `ai-worker`
- `app-server-image`
- `realtime-server-image`
- `ai-worker-image`
- `secrets`
- `python-audit`
- `terraform`

## App CI

앱 CI는 PR에서 다음을 확인한다.

- Node 앱: `npm ci`, `npm run format:check`, `npm run lint`, `npm test`, `npm run build`, `npm audit --omit=dev --audit-level=high`
- AI Worker: `pip install`, `black --check`, `ruff check`, `pytest`, `python -m compileall`

## Docker CI

Docker CI는 PR에서 backend/worker Dockerfile이 빌드 가능한지만 확인한다.

- ECR push는 하지 않는다.
- ECS 배포는 하지 않는다.

## Security CI

Security CI는 PR에서 아래 항목을 확인한다.

- `gitleaks`: secret 커밋 방지
- `pip-audit`: AI Worker Python production dependency 취약점 검사

Terraform IaC 보안 스캔은 dev 인프라의 의도적인 public ALB와 넓은 GitHub Actions role 권한 때문에 아직 required gate로 두지 않는다. production 환경 분리 시 `checkov`, `tfsec`, `trivy config` 중 하나를 별도 gate로 추가한다.

## Branch protection

`main` 브랜치는 아래 규칙을 사용한다.

- PR 필수
- required status checks 통과 필수
- 최소 1명 review 필수
- stale review dismiss 활성화
- conversation resolution 필수
- admin에게도 보호 규칙 적용
- direct push 금지
- force push 금지
- branch deletion 금지

Required check는 아래 job 이름을 사용한다.

- `frontend`
- `app-server`
- `realtime-server`
- `ai-worker`
- `app-server-image`
- `realtime-server-image`
- `ai-worker-image`
- `secrets`
- `python-audit`
- `terraform`

배포 workflow는 PR merge gate로 사용하지 않는다. `Deploy Frontend`,
`Deploy App Server`, `Deploy Realtime Server`, `Deploy AI Worker`는 `main`
merge 이후 경로 변경 또는 수동 실행으로 동작한다.
