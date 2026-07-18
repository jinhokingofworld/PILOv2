# Agent Tool Retrieval dev rollout

## 범위

`AGENT_TOOL_RETRIEVAL_MODE`는 Agent Worker의 ECS task 환경 변수다. dev의 기본값은
`shortlist`이며, 지원하는 값은 아래 두 개뿐이다.

| 값 | planner에 전달하는 tool schema |
| --- | --- |
| `shadow` | 현재 hard-eligible 전체 tool schema |
| `shortlist` | retrieval로 선택한 read/write capability와 필요한 prerequisite chain |

빈 값이나 알 수 없는 값은 Worker에서 `shadow`로 처리한다. remote flag와 Workspace별 allowlist는
이 rollout의 범위가 아니다.

## shortlist 안전 정책

- catalog가 없는 구형 job은 기존 전체-tool 경로로 fallback한다.
- catalog SHA 불일치 또는 eligible schema와 catalog digest 불일치는 planner를 호출하지 않고
  clarification으로 종료한다.
- 낮은 confidence, retriever 오류, schema budget 초과는 기존 전체-tool 경로로 fallback한다.
- shortlist 밖 tool 또는 field를 planner가 반환하면 normalization이 거부한다.
- shortlist 여부와 무관하게 App Server의 input validator, Workspace 권한, confirmation, 멱등성,
  실행 직전 상태·권한 재검증은 실행 권위 경계로 유지된다.

Worker step의 `outputSummary.toolRetrieval`에는 mode, fallback reason, catalog/eligible snapshot/
planner tool snapshot SHA만 기록한다. raw 발화, tool input, resource ID, token은 기록하지 않는다.

## dev 전환과 rollback

1. `infra/envs/dev/main.tf`에서 Agent Worker의 `AGENT_TOOL_RETRIEVAL_MODE` 값을 확인한다. 기본값은
   `shortlist`다.
2. Terraform apply로 새 ECS task definition을 배포하고 Agent Worker service가 stable 상태가 될 때까지
   기다린다.
3. 새 Agent run의 planner step에서 `outputSummary.toolRetrieval.mode`, `usedShortlist`, fallback reason과
   세 SHA를 확인한다. raw 요청·UUID·token이 output summary에 없는지도 확인한다.
4. 문제 발생 시 같은 환경 변수를 `shadow`로 바꾸고 Terraform apply로 Agent Worker task를 rollout한다.
   새 run이 전체 hard-eligible tool schema를 받는지 확인한다.

rollback은 planner tool handoff만 바꾼다. 이미 생성된 confirmation, 실행 중인 run, domain write 결과를
되돌리거나 재실행하지 않는다. catalog integrity failure는 `shadow`로 자동 fallback하지 않으며,
clarification으로 끝난 run을 사용자가 다시 요청해야 한다.
