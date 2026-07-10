# PR Review Module

Owner: 은재

API contract: `docs/api/pr-review-api.md`

범위:

- review session 생성, 조회, 삭제
- review flow, review file, diff view model
- file review decision 저장
- GitHub Review submission

주의:

- Review session은 MVP에서 리뷰 화면 동안만 유지하는 임시 작업 데이터다.
- 사용자가 PR 리뷰 화면을 나가면 delete API로 session을 삭제한다.
- GitHub Review 제출은 현재 사용자의 OAuth token을 사용한다.

AI 분석 환경 변수:

- `OPENAI_API_KEY`: 있으면 PR Review 분석 생성 시 OpenAI Responses API를 호출한다.
- `OPENAI_PR_REVIEW_MODEL`: 선택값. local 기본값은 `gpt-5.1-mini`이고, dev ECS 배포 환경은
  `infra/envs/dev/main.tf`에서 `gpt-5.5`를 주입한다.
- `OPENAI_PR_REVIEW_TIMEOUT_MS`: 선택값. local 기본값은 `15000`이고, dev ECS 배포 환경은
  `45000`을 주입한다.
- API key가 없거나 호출/검증에 실패하면 PR 분석은 deterministic fallback 분석을 저장하고,
  conflict suggestion은 저장 없이 deterministic fallback 초안을 반환한다.
