Agent tool 작업 가이드 공유합니다.

Agent core/runtime/planner/registry 연결은 제가 담당합니다.
각 도메인 담당자는 자기 도메인 기능을 Agent tool adapter로 감싸는 작업까지만 맡아주세요.

## 기본 원칙

- 기존 domain service를 호출하는 얇은 wrapper로 만든다.
- DB를 직접 만지지 않는다.
- API 계약/DB schema를 바꾸지 않는다.
- 기존 도메인 권한 검증과 validation 흐름을 우회하지 않는다.
- read-only tool은 `executionMode: "auto"`로 둘 수 있다.
- 생성/수정/삭제/외부 상태 변경 tool은 `executionMode: "confirmation_required"`로 만든다.
- MVP에서는 `riskLevel: "high"` tool을 구현하지 않는다.
- tool output에는 요약, resource id, 상태만 담는다.
- 긴 원문, transcript 전문, provider raw, token, secret은 저장하거나 반환하지 않는다.

## 구현 범위

각 도메인 담당자는 아래까지만 구현합니다.

- `apps/app-server/src/modules/agent/tools/<domain>-agent-tools.service.ts`
- 해당 service의 `listDefinitions()`
- 각 tool의 `inputSchema`
- 각 tool의 `validateInput(input: unknown)`
- 각 tool의 `execute(context, input)`
- write tool인 경우 `buildConfirmation(input)`
- 도메인 전용 test

아래는 직접 수정하지 않습니다.

- `AgentToolRegistryService`
- `AgentModule`
- `AgentPlannerService`
- Agent runtime
- `src/app.module.ts`
- `package.json`
- `scripts/test.mjs`

registry 연결과 planner/runtime 연결은 Agent 담당자가 별도 PR에서 처리합니다.

## 폴더 구조

Agent tool adapter는 각 도메인 폴더가 아니라 Agent 모듈 아래에 둡니다.

권장 구조:

```text
apps/app-server/src/modules/agent/
  tools/
    calendar/
      calendar-agent-tools.service.ts
    meeting/
      meeting-agent-tools.service.ts
    board/
      board-agent-tools.service.ts
    pr-review/
      pr-review-agent-tools.service.ts
    github-integration/
      github-agent-tools.service.ts
```

도메인의 원래 기능과 API는 기존 도메인 모듈에 둡니다.

```text
apps/app-server/src/modules/calendar/
  calendar.module.ts
  calendar.service.ts
  calendar.controller.ts

apps/app-server/src/modules/board/
  board.module.ts
  board.service.ts
  board.controller.ts
```

의존 방향은 아래처럼 유지합니다.

```text
AgentModule
  -> <Domain>Module
  -> <Domain>Service 호출
```

도메인 모듈이 Agent 타입이나 Agent tool을 import하지 않도록 합니다.

```text
금지:
CalendarModule -> AgentToolDefinition import
BoardModule -> Agent runtime import
MeetingModule -> Agent registry import
```

테스트는 Agent tool 동작을 검증하는 것이므로 Agent script 아래에 둡니다.

```text
apps/app-server/scripts/agent/calendar-tools.test.mjs
apps/app-server/scripts/agent/meeting-tools.test.mjs
apps/app-server/scripts/agent/board-tools.test.mjs
```

단, `apps/app-server/scripts/test.mjs`, `package.json` 같은 공통 test 연결 파일은
각 도메인 PR에서 직접 수정하지 않습니다. test 연결은 Agent 담당자가 별도 PR에서 처리합니다.

## 구현해야 하는 필드

- `name`: snake_case. 예: `search_board_issues`
- `description`: LLM이 이해할 수 있는 짧은 설명
- `riskLevel`: `low | medium`
- `executionMode`: `auto | confirmation_required`
- `inputSchema`: plain object JSON schema 형태
- `validateInput(input: unknown)`: 실제 input 검증
- `buildConfirmation`: write tool일 때만 필요
- `execute(context, input)`: 기존 도메인 service 호출

## confirmation 기준

write tool은 confirmation plan에 아래 정보를 넣어야 합니다.

- 변경 대상
- 현재 값
- 변경 예정 값
- 호출할 API 또는 provider
- 실행에 필요한 최소 JSON

approve 요청에서 새 실행값을 받는 구조로 만들지 않습니다.
승인 시에는 저장된 plan만 실행합니다.

## 참고 구현

- Calendar tool: `apps/app-server/src/modules/agent/tools/calendar-agent-tools.service.ts`
- MeetingReport tool: `apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts`
- 공통 타입: `apps/app-server/src/modules/agent/types/agent-tool.types.ts`

## PR 기준

- 각 PR은 자기 도메인의 tool adapter만 포함한다.
- Agent core/registry/planner/runtime 변경은 포함하지 않는다.
- API 계약 또는 DB schema 변경이 필요하면 구현 전에 멈추고 공유한다.
- 공통 영역 변경이 필요하면 구현 전에 멈추고 공유한다.
- tool test를 추가한다.
- 실제 Agent가 어떤 tool을 고르고 언제 실행할지는 Agent planner/runtime에서 별도로 연결한다.
