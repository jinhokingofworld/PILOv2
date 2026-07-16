# Agent Tool 개발 가이드

이 문서는 PILO 도메인 담당자가 자신의 기능을 Agent가 안전하게 사용할 수 있는 tool로
추가할 때 따르는 공용 규약이다. 구현 기준 API 계약은
[`docs/api/agent-api.md`](api/agent-api.md)와 각 도메인 API 문서이며, 이 문서는
그 계약을 App Server Agent adapter로 연결하는 방법을 설명한다.

## 1. 역할과 경계

Agent tool은 새 도메인 API나 DB 접근 계층이 아니다. 기존 domain service의 권한 검증과
validation을 그대로 사용하는 얇은 adapter다.

```text
AI Worker
  -> tool schema snapshot으로 계획 생성
App Server Agent runtime
  -> adapter의 validateInput
  -> 기존 DomainService
  -> bounded output / confirmation / run log
```

도메인 담당자는 자신의 adapter와 도메인 전용 테스트를 작성한다. Agent core 담당자는
registry·module 연결, AI Worker의 tool schema snapshot·planner·runtime 연결을 담당한다.
한 PR에서 둘을 함께 바꿔도 되지만, 책임자와 리뷰 범위를 PR 본문에 명시한다.

| 구분 | 도메인 담당자 책임 | Agent core 담당자 책임 |
| --- | --- | --- |
| 도메인 계약 | 기존 API/service 권한·validation 유지 | tool이 계약을 우회하지 않는지 검토 |
| adapter | definition, 입력 검증, domain service 호출, output projection, tool test | registry/module 연결 검토 |
| planner | 지원 범위·입력 의미를 설명에 명확히 제공 | AI Worker prompt/normalizer/eval 동기화 |
| write | confirmation plan의 도메인 의미와 stale 정책 제공 | approve/reject/runtime 멱등성 유지 |

기존 도메인 endpoint, request/response, auth rule, DB schema를 바꾸려면 먼저 해당
`docs/api/<domain>-api.md`와 `AGENTS.md`의 도메인·DB Schema owner 규칙을 따른다.

## 2. 현재 공통 계약

공통 타입은
[`agent-tool.types.ts`](../apps/app-server/src/modules/agent/types/agent-tool.types.ts)에
있고, registry는
[`agent-tool-registry.service.ts`](../apps/app-server/src/modules/agent/agent-tool-registry.service.ts)가
유일한 등록 지점이다.

모든 tool은 다음 메타데이터를 가진다.

| 필드 | 규칙 |
| --- | --- |
| `name` | 전역 고유한 `snake_case`. rename은 planner/eval 호환성 변경이다. |
| `description` | 지원하는 범위, 지원하지 않는 필터/동작, confirmation 필요 여부를 짧고 명확하게 쓴다. |
| `riskLevel` | `low`, `medium`, `high` 중 하나다. |
| `executionMode` | `low` read는 보통 `auto`, write는 `confirmation_required`다. |
| `inputSchema` | planner에 전달되는 공개 JSON Schema다. object는 `additionalProperties: false`를 사용한다. |
| `validateInput` | planner output을 신뢰하지 않고 App Server에서 다시 검증한다. |
| `execute` | `AgentToolContext`의 사용자·Workspace로 기존 domain service를 호출한다. |

`high` risk tool은 현재 실행하지 않는다. 삭제, 외부 provider 상태 변경, PR Review
제출처럼 high risk인 동작은 definition을 추가해도 runtime에서 실패하므로, 제품·보안
정책을 먼저 확정한다.

## 3. Adapter 구현 규칙

### 3.1 위치와 의존 방향

adapter는 아래처럼 Agent 모듈에 둔다.

```text
apps/app-server/src/modules/agent/tools/
  board-agent-tools.service.ts
  calendar-agent-tools.service.ts
  meeting-agent-tools.service.ts
  <domain>-agent-tools.service.ts
```

의존 방향은 항상 `AgentModule -> DomainModule -> DomainService`다. domain module은
Agent type, registry, runtime을 import하지 않는다. adapter가 DB query를 직접 작성하거나
domain controller를 HTTP로 다시 호출하지 않는다.

현재 Calendar, Meeting, Board 구현을 참고한다.

- [`board-agent-tools.service.ts`](../apps/app-server/src/modules/agent/tools/board-agent-tools.service.ts)
- [`calendar-agent-tools.service.ts`](../apps/app-server/src/modules/agent/tools/calendar-agent-tools.service.ts)
- [`meeting-agent-tools.service.ts`](../apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts)

### 3.2 입력 검증

`inputSchema`는 LLM 안내용이고 보안 경계가 아니다. `validateInput(input: unknown)`에서
반드시 아래를 수행한다.

1. plain object인지 확인한다.
2. 허용 field만 받는다.
3. `workspaceId`, `userId`, `currentUserId`, `requestedByUserId`, `createdBy`처럼
   실행 문맥을 주입하려는 field를 거부한다.
4. enum, UUID, date/time, limit, 문자열 길이와 도메인 제약을 검증한다.
5. 정규화한 typed input만 `execute`와 `buildConfirmation`에 전달한다.

현재 사용자와 Workspace는 입력에서 받지 않고 아래 context만 사용한다.

```ts
type AgentToolContext = {
  currentUserId: string;
  workspaceId: string;
  runId: string;
};
```

예를 들어 MeetingReport 조회의 `reportId`는 허용하지만, 다른 Workspace의
`workspaceId`를 planner input으로 받지 않는다. 접근 권한은 반드시 기존
`MeetingService`가 context의 사용자·Workspace로 다시 검사한다.

### 3.3 출력과 저장 제한

`execute`는 아래 형태를 반환한다.

```ts
{
  outputSummary: { /* 사용자 답변과 로그에 안전한 bounded projection */ },
  resourceRefs: [{ domain, resourceType, resourceId, label?, status?, metadata? }],
  status: "completed" // 선택
}
```

- `outputSummary`에는 화면에 필요한 요약과 formatter가 사용할 필드만 넣는다.
- `resourceRefs.resourceId`는 내부 audit/재조회 목적에만 쓴다. 최종 답변에 raw ID를
  노출할지 여부는 formatter가 명시적으로 결정한다.
- transcript 전문, provider raw payload, token, secret, credential, cookie,
  authorization header, 긴 원문은 output·log·SQS payload에 넣지 않는다.
- 목록과 상세 projection에는 상한을 둔다. Meeting adapter의 section/action item 길이
  제한이 기준 예시다.

## 4. Read, write, clarification

### Read-only tool

조회·요약 tool은 보통 `riskLevel: "low"`, `executionMode: "auto"`다. execute가
성공하면 runtime이 tool step을 완료하고 formatter가 `outputSummary`와
`resourceRefs`로 최종 답변을 만든다.

### Write tool과 confirmation

생성·수정·상태 변경은 `riskLevel: "medium"`,
`executionMode: "confirmation_required"`를 사용하고 `buildConfirmation`을 제공한다.

confirmation plan에는 반드시 아래를 포함한다.

- `toolName`, 사용자가 읽을 수 있는 `summary`
- 변경 대상 `target`
- 서버가 다시 읽은 현재값 `before`
- 변경 예정의 최소 값 `after`
- 내부 실행에 필요한 최소 `call`

approve 요청은 새 실행값을 받지 않는다. 저장된 plan만 실행한다. planner가 만든 현재값,
resource ID, Workspace/User 문맥은 신뢰하지 않는다.

Calendar 수정처럼 public planner input과 승인 실행 input이 다를 수 있다. 이 경우 공개
`inputSchema`와 `validateInput`에는 사용자 제공 target만 두고, 서버가 resolve한 내부
resource ID는 `validateConfirmationInput`으로만 검증한다. 내부 ID를 공개 schema에
되돌려 넣지 않는다.

도메인별 confirmation plan에서 승인 실행 input을 복원해야 하면 definition의
`buildConfirmationInput(plan)`을 사용한다. 이 함수는 저장된 `target`, `before`, `after`,
`call`의 최소 값만 실행 input으로 옮기며, 반환값은 반드시 `validateConfirmationInput`으로
다시 검증한다. approve request body나 planner input에서 내부 ID를 다시 받지 않는다.

후보가 0개 또는 여러 개인 경우처럼 confirmation을 만들 수 없지만 안전한 재질문이
가능한 tool은 `AgentToolClarificationResult`를 반환한다.

```ts
{
  kind: "needs_clarification",
  outputSummary: { status: "needs_clarification", /* bounded reason */ },
  resourceRefs: []
}
```

이 결과는 write나 pending confirmation 없이 run을 완료한다. 후보 선택 UI, 별도 run
상태, DB migration을 필요로 하는 흐름은 이 규약에 임의로 추가하지 말고 제품/API
계약으로 먼저 분리한다.

### Stale 대상

confirmation 전에는 대상 resource를 현재 사용자·Workspace 범위에서 다시 읽어야 한다.
approval 시점의 stale/version conflict를 감지해야 하는 도메인은 기존 domain service의
optimistic lock 또는 해당 도메인 owner가 승인한 precondition을 사용한다. Agent adapter가
도메인 고유 concurrency 정책을 새로 정의하지 않는다.

## 5. Grounded answer는 예외 경로

`requiresGroundedAnswer: true`는 일반 read tool의 formatter 완료 경로가 아니다. 현재
Meeting transcript 검색처럼 App Server가 권한 있는 source를 검색하고, 별도 outbox로
bounded context answer를 요청하는 경우에만 쓴다.

이 옵션을 새 tool에 사용하려면 Agent core와 도메인 owner의 사전 검토가 필요하다.

- source 전문·embedding·raw transcript를 Agent run/step/log/SQS에 저장하지 않는다.
- tool output에는 source ID와 안전한 상태만 남긴다.
- answer phase는 허용된 source ID만 citation으로 사용한다.
- source가 없으면 두 번째 LLM 호출 없이 종료하는 정책을 명시한다.

일반 domain read tool은 이 옵션을 사용하지 말고 bounded projection과 formatter를 사용한다.

## 6. Registry, module, planner 연결

adapter 파일만 추가하면 AI Worker가 tool을 알지 못한다. 완료된 tool은 다음 연결을 모두
확인한다.

1. `<Domain>AgentToolsService.listDefinitions()`가 definition을 반환한다.
2. `AgentModule`이 필요한 `<Domain>Module`과 adapter provider를 등록한다.
3. `AgentToolRegistryService` constructor가 adapter의 `listDefinitions()`를 등록한다.
4. `AgentOutboxPublisherService`가 registry snapshot을 Agent job에 넣는다.
5. AI Worker가 전달된 `inputSchema`로 planner를 호출하고, App Server가 같은 definition으로
   risk/execution mode/input을 재검증한다.

tool 이름·공개 input schema·risk/execution mode를 바꾸면 App Server뿐 아니라 AI Worker
prompt, normalizer, planner eval fixture, 배포 중 구버전 worker 호환성을 함께 확인한다.
특정 tool 이름을 하드코딩한 AI Worker 규칙은 schema와 같은 PR에서 갱신하고 회귀 테스트를
추가한다.

## 7. 문서와 테스트 체크리스트

### 문서

- [ ] 기존 도메인 API만 사용하면 `docs/api/agent-api.md`의 Tool 목록·실행 규칙을 갱신한다.
- [ ] endpoint/request/response/auth rule이 바뀌면 해당 `docs/api/<domain>-api.md`도 함께 갱신한다.
- [ ] DB schema가 바뀌면 migration과 DB Schema owner 확인을 추가한다.
- [ ] 지원하지 않는 필터, write 범위, identifier 노출 정책을 description과 API 문서에 적는다.

### 자동 테스트

- [ ] registry에 등록됐고 duplicate name이 없는지 확인한다.
- [ ] 정상 입력과 빈/부분 입력, 허용하지 않은 field, context/ID 주입을 검증한다.
- [ ] Workspace 권한과 domain service 재검증 경로를 확인한다.
- [ ] read는 bounded output과 민감정보 비노출을 확인한다.
- [ ] write는 confirmation 생성, approve, reject, expiry, duplicate approve를 확인한다.
- [ ] 후보 기반 write는 0/1/N 후보, stale 대상, cross-workspace를 확인한다.
- [ ] tool schema나 특수 planner 규칙을 바꾸면 AI Worker planner eval과 App Server execution
  회귀를 함께 실행한다.

도메인 test는 `apps/app-server/scripts/agent/<domain>-tools.test.mjs`에 둔다. runtime,
registry, confirmation 변경은 Agent core test에도 추가한다.

### 수동 E2E

- [ ] 자연어 요청이 의도한 tool과 input으로 plan되는지 확인한다.
- [ ] read가 최종 답변으로 완료되는지 확인한다.
- [ ] write가 confirmation 전에는 domain state를 바꾸지 않는지 확인한다.
- [ ] approve 후 정확히 한 번 실행되고, reject/expiry 후 실행되지 않는지 확인한다.
- [ ] worker/provider/domain failure가 raw provider 정보 없이 안전한 메시지로 끝나는지 확인한다.

## 8. PR 경계

도메인 tool PR에는 adapter, 필요한 DomainModule import, tool test, API 문서 변경만 넣는다.
Agent core/registry/planner/runtime 또는 shared App Server 영역 변경이 필요하면 PR 본문에
다음 내용을 적고 담당자와 조율한다.

- 변경 경로와 필요한 이유
- 영향을 받는 tool·도메인·endpoint
- registry snapshot 및 AI Worker 호환성 검증 방법
- API 계약/DB schema/Frontend 공통 영역 영향

`src/app.module.ts`, `src/common/`, `src/database/`, App Server tooling config는
`APP_SERVER_COMMON_AREAS.md`의 공통 영역이다. 해당 경로가 필요하면 구현 전에 멈추고
영향 범위와 검증 방법을 합의한다.

## 9. 완료 기준

새 tool은 아래가 모두 충족되어야 완료다.

- 도메인 service의 권한·validation을 우회하지 않는다.
- planner input과 승인 실행용 내부 input을 구분한다.
- risk와 confirmation 경계가 제품 정책과 일치한다.
- output, log, job payload가 bounded이고 민감정보를 포함하지 않는다.
- registry snapshot부터 AI Worker planner, App Server validation/execution까지 연결된다.
- 자동 테스트와 관련 API 문서가 갱신된다.
