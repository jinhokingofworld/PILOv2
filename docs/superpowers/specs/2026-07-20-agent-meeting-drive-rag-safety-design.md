# Agent Meeting·Drive RAG 안정화 설계

## 목표

Meeting·Drive 의미 검색이 단순히 가장 가까운 결과를 근거로 채택하지 않게 한다.
질문과 충분히 관련된 자료만 Agent 답변에 전달하고, 관련 자료가 없거나 embedding
호출이 실패한 경우를 구분한다. 검색 및 색인 embedding에는 명시적인 timeout을
적용하고, 답변 citation은 서버가 제공한 근거 범위 안에서만 허용한다.

이 작업은 GitHub Issue #1558 전체를 하나의 PR로 구현한다. 사용자가 요청한 대로
전체 test suite는 실행하지 않고 변경 경계에 필요한 테스트만 수행한다.

## 확정된 제품 정책

- 검색은 정확도 우선이다. 관련성이 애매하면 자료를 반환하지 않는다.
- Meeting과 Drive는 별도 relevance threshold를 사용한다.
- similarity score는 내부 판정과 Agent 실행 진단에만 사용하며 사용자 UI에는
  숫자로 표시하지 않는다.
- 실제로 관련 자료가 없는 경우와 embedding timeout은 서로 다른 결과로 처리한다.
- query embedding timeout은 사용자에게 재시도 안내를 반환한다.
- 색인 embedding은 timeout을 포함한 일시적 provider 장애에서 최초 호출 포함
  최대 3회 시도한다.
- 관련 근거가 있는 사실 답변은 유효한 citation을 최소 1개 포함해야 한다.
- citation 누락 또는 허용되지 않은 citation 사용 시 같은 근거로 답변을 1회만
  다시 생성한다. 두 번째 답변도 유효하지 않으면 근거 없는 답변을 노출하지 않는다.
- threshold 보정에는 저장소에 넣어도 안전한 가상 회의·문서 문장과 기존 테스트
  fixture만 사용한다. 실제 Workspace 자료는 읽거나 저장하지 않는다.

## 범위

### 포함

- App Server의 Meeting·Drive query embedding timeout
- AI Worker의 Meeting transcript·activity evidence 색인 embedding timeout과 재시도
- Workspace Indexing Worker의 Drive 문서 색인 embedding timeout과 재시도
- Meeting·Drive threshold-first retrieval
- Meeting·Drive 공통 grounding outcome과 bounded source/citation 계약
- Drive chunk 단위 citation과 최신 active snapshot 재검증
- citation allow-list, 최소 1개 citation, 1회 답변 재생성
- 환경변수·Terraform·Agent/Meeting/Drive API 문서 갱신
- 작은 relevance 평가 fixture와 결과 기록

### 제외

- 별도 LLM reranker 또는 citation 의미 검증 모델
- 키워드·BM25와 vector를 결합한 hybrid search
- 사용자 또는 Planner가 threshold·timeout을 지정하는 기능
- 실제 Workspace 데이터를 이용한 평가
- Frontend에 similarity score를 표시하는 기능
- DB schema migration

구현 중 DB migration이 필요하다고 확인되면 작업을 멈추고 사용자에게 알린다.

## 접근 방식

### 선택: threshold-first retrieval

두 도메인 모두 cosine similarity를 `1 - cosine distance`로 정규화한다. DB에서 최종
반환 개수보다 넉넉한 후보를 읽은 뒤, 다음 순서를 고정한다.

1. 현재 Workspace와 사용자 접근 권한을 검증한다.
2. server-owned timeout으로 query embedding을 생성한다.
3. 현재 유효한 index에서 후보를 조회한다.
4. 도메인별 threshold 미만 후보를 제거한다.
5. 통과한 후보에만 중복 제거, 직접 참조 우선순위, source type 다양성 정렬을 적용한다.
6. 최대 5개의 bounded source를 공통 grounding 계약으로 변환한다.

Meeting의 `directlyReferenced` boost는 threshold 통과 여부를 바꾸지 않는다. transcript와
activity 대표를 하나씩 강제로 포함하는 로직도 해당 source type에 threshold를 통과한
후보가 있을 때만 동작한다. Drive는 `documents.latest_snapshot_id`와 일치하는 chunk만
계속 사용한다.

Meeting transcript 검색은 현재 transcript hash와 완료된 embedding job이 일치하는
chunk만 사용한다. 새 transcript 색인이 timeout되거나 실패하면 이전 transcript hash의
chunk를 현재 근거로 사용하지 않는다. activity evidence도 현재 MeetingReport에 속하고
embedding이 완료된 현재 evidence만 후보가 된다.

### 선택하지 않은 접근

- LLM reranking은 추가 비용·지연과 비결정성을 만들기 때문에 제외한다.
- hybrid search는 고유명사 검색에는 유리하지만 점수 결합과 별도 평가가 필요해 이번
  안전성 작업의 범위를 벗어난다.

## Relevance threshold 보정

Meeting과 Drive에 각각 작은 한국어 평가 fixture를 둔다. 각 fixture는 질문, 후보 문장,
`relevant` 또는 `irrelevant` label과 경계 사례 설명을 포함한다. 예시는 실제 PILO와
비슷한 배포 구조, 파일 저장소, 회의 결정, 일정과 문서 주제를 사용하지만 모두 가상
문장으로 작성한다.

보정 순서는 다음과 같다.

1. 같은 embedding model과 dimension으로 fixture 점수를 측정한다.
2. 무관 후보가 통과하지 않는 범위를 먼저 찾는다.
3. 그 범위에서 관련 후보 recall이 가장 높은 값을 도메인 기본값으로 선택한다.
4. 선택한 Meeting·Drive 기본값과 평가 요약을 PR에 기록한다.
5. 경계값 바로 위·아래 동작을 결정적인 회귀 테스트로 고정한다.

런타임 threshold는 App Server가 소유한 `MEETING_RAG_MIN_SIMILARITY`와
`DRIVE_RAG_MIN_SIMILARITY` 환경변수로 조정할 수 있다. Planner input, tool input,
Frontend request에는 노출하지 않는다. 설정이 없으면 평가로 정한 기본값을 사용하고,
유효 범위를 벗어난 설정은 조용히 완화하지 않고 서버 시작 단계에서 거부한다.

평가용 embedding 측정은 명시적으로 실행하는 작은 스크립트로 분리하며 CI의 네트워크
의존 테스트로 만들지 않는다. 저장소에는 secret, 실제 문서 원문, 실제 transcript를
기록하지 않는다.

## Timeout과 오류 분류

### 기본값

- App Server query embedding: 10초
- Meeting·Drive Worker indexing embedding 호출: 30초
- 색인 시도 횟수: 최초 호출 포함 최대 3회

App Server는 `OPENAI_QUERY_EMBEDDING_TIMEOUT_MS`, Worker는
`OPENAI_INDEXING_EMBEDDING_TIMEOUT_SECONDS`를 사용한다. 값은 배포 환경이 소유하며
사용자 요청으로 변경할 수 없다.

### Query embedding

Meeting·Drive App Server fetch는 AbortSignal 기반 timeout을 사용한다. timeout, 연결
오류, rate limit, provider 5xx는 `embedding_temporarily_unavailable` 계열의 retryable
오류로 정규화한다. 이 경우 검색 쿼리를 실행하지 않고, 빈 결과나
`no_relevant_sources`로 위장하지 않는다. Agent run에는 다음의 결정적인 사용자 안내를
기록한다.

> 자료 검색이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.

비정상 query input, embedding dimension 불일치, non-finite vector, provider의 명확한
비재시도 4xx는 terminal 오류로 분류한다.

### Indexing embedding

Python OpenAI client에는 호출당 30초 timeout을 명시한다. timeout, 연결 오류, rate
limit, provider 5xx는 retryable이다. 입력이 비었거나 응답 개수·dimension·vector가
잘못된 경우는 terminal이다.

- Drive는 기존 SQS receive count와 message 재전달을 사용해 최대 3회를 유지한다.
- Meeting transcript와 activity evidence는 기존 job `attempt_count`를 사용한다.
  retryable 실패이며 attempt가 남아 있으면 job을 다시 `pending`으로 전환하고,
  3회째 실패에서 `failed`로 종료한다.
- timeout 전에 일부 vector를 메모리에서 만들었더라도 전체 batch가 성공하기 전에는
  chunk 교체나 job 완료를 commit하지 않는다.
- 실패 메시지에는 token, provider raw payload, 원문 transcript·문서 내용을 넣지 않는다.

## 공통 Grounding source 계약

Meeting과 Drive 검색 결과는 내부 공통 구조로 변환한다.

```ts
type GroundingSource = {
  citationId: string;
  sourceType: "meeting_transcript" | "meeting_activity" | "drive_document";
  title?: string;
  excerpt: string;
  resourceRef: AgentResourceRef;
  score: number; // 내부 저장·진단용, UI 미표시
};
```

`citationId`는 grounded answer 요청 안에서 서버가 발급하는 opaque ID다. AI Worker에는
opaque ID와 bounded source projection만 전달한다. 내부 Meeting chunk ID, Drive chunk
ID, document ID와 citation ID의 매핑은 App Server가 보존하고 완료 시 다시 검증한다.
기존 grounded-answer outbox의 JSONB payload를 bounded citation registry로 확장하고
legacy string source ID도 읽을 수 있게 해 DB migration 없이 전환한다.

bounded projection은 source type, 제한된 제목·요약·발췌, 앱 내부 resource reference만
포함한다. raw 문서 전체, transcript 전체, embedding vector, provider payload는 Agent
step, outbox, Worker prompt에 복제하지 않는다.

Drive는 최종 선택된 chunk마다 citation을 하나 만든다. 동일 문서에서 여러 chunk가
통과하더라도 최종 결과는 문서별 대표 chunk로 제한해 링크 중복을 피한다. citation 완료
시점에도 Workspace 접근, document 삭제 여부, 최신 active snapshot과 chunk 소속을
다시 검증한다.

## Grounding outcome과 답변 생성

공통 outcome은 다음 둘이다.

- `sources_found`: threshold를 통과하고 완료 시점에 재검증된 source가 1개 이상
- `no_relevant_sources`: 유효 source가 0개

`no_relevant_sources`에서는 grounded answer LLM job을 만들지 않고 다음 문장을 직접
완료 결과로 사용한다.

> 현재 접근 가능한 회의록과 문서에서 질문과 관련된 근거를 찾지 못했습니다. 대상을 조금 더 구체적으로 입력해 주세요.

`sources_found`에서는 AI가 반환한 citation이 제공된 citation allow-list의 비어 있지
않은 부분집합이어야 한다. Worker가 1차 응답을 검사하고 citation 누락 또는 unknown
ID가 있으면 같은 source로 답변을 1회 다시 생성한다. App Server는 handoff에서도 같은
규칙을 독립적으로 검증한다. 2차 응답도 잘못되면 답변을 저장하지 않고 안전한 일시적
생성 실패로 terminalize한다. citation이 해당 문장을 의미적으로 충분히 지지하는지
별도 LLM으로 재평가하는 기능은 이번 범위에 포함하지 않는다.

Drive search tool도 Meeting evidence search와 같은 grounded answer 경계를 사용한다.
최종 답변에는 citation으로 실제 사용된 자료의 이름, source type, bounded metadata와
검증된 앱 내부 링크만 반환한다. score는 API 응답의 사용자 표시 영역에 포함하지 않는다.

## 데이터와 API 영향

- DB migration: 없음
- 기존 JSONB outbox와 Agent step payload: bounded citation registry로 확장
- 공개 Drive·Meeting domain endpoint: 변경 없음
- Agent tool/result 및 내부 grounded-answer handoff 계약: 변경 있음
- Frontend: 숫자 score를 표시하지 않으며 기존 resource link 표시를 재사용
- Activity Log: read-only 검색과 답변 생성이므로 추가하지 않음

API 문서는 `docs/api/agent-api.md`, `docs/api/meeting-api.md`,
`docs/api/drive-api.md`를 함께 갱신한다.

## 배포

App Server와 AI/Indexing Worker는 코드 기본값을 가지므로 환경변수가 아직 없어도 새
계약을 수용한다. 안전한 배포 순서는 다음과 같다.

1. timeout·citation 계약을 수용하는 App Server와 Worker 배포
2. Terraform 환경변수 반영
3. relevance 평가 결과에 따라 threshold 환경값 조정

환경변수 누락은 fail-open으로 threshold를 제거하지 않고 평가로 정한 보수적 기본값을
사용한다.

## 최소 검증 범위

전체 suite 대신 아래만 실행한다.

### App Server

- Meeting 전체 후보 threshold 미달 시 source 0건
- Meeting 직접 참조 boost가 threshold 미달 후보를 승격하지 않음
- Meeting source type 대표 강제 포함이 threshold 이후에만 동작
- Drive threshold 미달 결과가 tool output·resource ref에 없음
- Drive 최신 snapshot과 citation registry 재검증
- query embedding timeout과 `no_relevant_sources` 구분
- source 0건에서 grounded answer job 미생성
- citation allow-list, citation 최소 1개, legacy source payload 호환
- App Server TypeScript build

### AI Worker

- Meeting transcript/activity embedding timeout retry와 3회 소진
- Drive embedding timeout retry와 3회 소진
- malformed vector terminal 분류
- grounded answer citation 누락·unknown ID에서 정확히 1회 재생성
- 두 번째 citation 실패에서 안전한 terminal 결과

### Infra와 문서

- 변경한 Terraform 파일 formatting
- 관련 Agent·Meeting·Drive API 문서 계약 확인

실제 OpenAI 네트워크 호출을 일반 단위 테스트에 넣지 않는다. timeout과 provider 오류는
fake client/fetch로 결정적으로 검증한다. relevance 평가 스크립트만 명시적으로 실행하며,
그 결과와 선택 threshold를 PR에 기록한다.

## 완료 조건

- 무관한 Meeting·Drive 자료가 단순 top result라는 이유로 근거에 포함되지 않는다.
- 검색 실패와 관련 자료 없음이 사용자에게 서로 다르게 전달된다.
- 색인 timeout이 무한 대기하거나 부분 index를 commit하지 않는다.
- citation 없는 사실 답변과 unknown citation 답변이 사용자에게 노출되지 않는다.
- score와 raw source data가 사용자 UI나 불필요한 저장 경계로 유출되지 않는다.
- DB migration 없이 App Server·Worker·Infra·API 문서가 하나의 PR에서 일관되게 변경된다.
