# Agent 문서 원본 링크 공통 계약 설계

## 목표

Agent가 답변이나 작업을 위해 실제로 조회한 Drive 문서는 Tool 종류와 관계없이 원본 문서 링크로 제공한다. 관련도를 추측해 링크를 추가하지 않고, 실제 조회 근거에 포함된 문서만 대상으로 한다.

## 적용 기준

- grounded-answer Tool이 `drive_document` 근거를 사용하면 해당 근거의 문서 reference를 Tool step의 `resourceRefs`에도 포함한다.
- grounded-answer를 사용하지 않는 Tool이 문서를 직접 읽었다면 해당 Tool이 읽은 문서를 `resourceRefs`로 반환한다.
- 문서를 생성·수정했지만 읽지 않은 작업에는 이 규칙으로 링크를 추가하지 않는다.
- 동일한 문서를 여러 chunk에서 읽거나 여러 reference로 반환해도 문서 ID 기준 한 번만 표시한다.
- 문서 제목과 내부 원본 경로만 전달하며 원문, excerpt, embedding 점수는 resource reference에 저장하지 않는다.

## 구조

### App Server 공통 실행 경계

Agent Tool 실행 결과를 저장하기 전에 다음 두 출처의 reference를 합친다.

1. Tool이 명시적으로 반환한 `resourceRefs`
2. `groundingSources`가 가진 `resourceRef`

합친 결과는 기존 `sanitizeResourceRefs`를 통과시키고 `domain + resourceType + resourceId` 기준으로 중복 제거한다. 따라서 `search_workspace_documents`, `search_meeting_transcript`뿐 아니라 앞으로 추가되는 grounded-answer Tool도 별도 이름 하드코딩 없이 같은 동작을 얻는다.

### Tool 계약

- 실제로 읽은 Drive 문서는 `domain: "drive"`, `resourceType: "document"`, 문서 UUID, bounded 제목, 서버가 만든 `/files?documentId=<uuid>` 경로를 사용한다.
- grounded-answer Tool은 문서 근거를 `groundingSources`에 포함하는 것만으로 공통 링크 계약을 충족한다.
- 비-grounded Tool은 읽은 문서를 명시적으로 `resourceRefs`에 포함한다.

### Frontend

공통 Agent 링크 변환기가 Drive 문서 reference를 표시한다. domain, resource type, UUID와 정확한 내부 경로를 모두 검증하고, 외부 URL·추가 query·hash·역슬래시 경로는 거절한다.

## 오류 처리

- reference가 불완전하거나 URL 검증에 실패하면 링크만 표시하지 않고 Agent 답변 자체는 유지한다.
- Drive 검색 실패 정책은 각 조회 Tool의 기존 정책을 유지한다.
- 인증, Workspace 권한, DB 오류를 문서 링크 처리에서 숨기지 않는다.

## 변경 영향

- DB migration, confirmation, Activity Log 변경은 없다.
- App Server와 Frontend의 Agent 도메인 계약이 변경된다. 두 경로 모두 각 앱의 `*_COMMON_AREAS.md`가
  지정한 사이렌 공통 경로에는 포함되지 않는다.
- 여러 도메인 Tool이 따르는 Agent 계약 변경이므로 PR에서 영향 범위와 검증 결과를 명시하고 Agent 담당자
  리뷰를 받는다.

## 검증

- Tool이 Drive grounding source만 반환해도 저장된 step에 문서 reference가 포함된다.
- Tool reference와 grounding reference가 중복되어도 문서 링크는 하나만 남는다.
- 실제로 조회하지 않은 문서는 자동으로 추가되지 않는다.
- 정상 MeetingReport·Drive 링크는 표시되고 변조된 링크는 표시되지 않는다.
- 기존 SQLtoERD·Canvas resource link 동작은 유지된다.
