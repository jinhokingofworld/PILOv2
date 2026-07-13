# PR Review Module

Owner: 은재

API contract: `docs/api/pr-review-api.md`

범위:

- PR별 공유 review room 생성, 합류, 조회, 영구 삭제
- head SHA별 review session(revision) 생성과 조회
- review flow, review file, diff view model
- file review decision 저장
- GitHub Review submission

주의:

- 같은 Workspace/PR에는 공유 review room과 `board_type=review` Canvas가 하나씩 존재한다.
- Review session은 room 안의 불변 head SHA revision이며, 분석 성공 후에만 room의 현재
  revision으로 선택된다.
- room 삭제는 모든 revision, 판단·제출 이력과 연결 Canvas를 함께 영구 삭제한다.
- GitHub Review 제출은 현재 사용자의 OAuth token을 사용한다.

AI 분석 환경 변수:

- `OPENAI_API_KEY`: 있으면 PR Review 분석 생성 시 OpenAI Responses API를 호출한다.
- `OPENAI_PR_REVIEW_MODEL`: 선택값. local 기본값은 `gpt-5.1-mini`이고, dev ECS 배포 환경은
  `infra/envs/dev/main.tf`에서 `gpt-5.5`를 주입한다.
- `OPENAI_PR_REVIEW_TIMEOUT_MS`: 선택값. local 기본값은 `15000`이고, dev ECS 배포 환경은
  App Server에 `45000`, PR Review 전용 Worker에 `60000`을 주입한다.
- API key가 없거나 호출/검증에 실패하면 PR 분석은 deterministic fallback 분석을 저장하고,
  conflict suggestion은 저장 없이 deterministic fallback 초안을 반환한다.
