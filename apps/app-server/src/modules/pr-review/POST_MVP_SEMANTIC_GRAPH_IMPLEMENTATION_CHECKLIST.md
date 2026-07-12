# PR Review Post-MVP Semantic Review Graph 구현 체크리스트

이 문서는 PR Review Post-MVP의 세 번째 축인 `Semantic Review Graph`를 작은 PR 단위로
구현하기 위한 진행 기준이다. 상위 추적 Issue는 `#772`이며, 첫 작업 Issue는 `#773`이다.

API endpoint, request, response 또는 status code가 바뀌면
`docs/api/pr-review-api.md`를 함께 수정한다. Table, column, constraint, index가 바뀌면
DB migration과 schema 검증을 같은 PR에 포함한다.

## 목표

현재 PR Review graph는 파일의 `workflowOrder`를 따라 순차 edge를 만들고, Frontend가
파일 경로와 역할 문자열로 배치 단계를 추론한다. 이를 변경 파일 사이의 의미 관계와
기능 Flow를 보여주는 리뷰 지도로 고도화한다.

```text
변경 파일 경로/patch
  -> deterministic 역할·관계 후보
  -> AI 설명·Flow 보강
  -> 서버 graph validator
  -> 관계와 Flow 원자 저장
  -> lane/cluster Review room
```

## 1차 확정 범위

### 입력

- PR 제목, 본문, branch, head/base SHA와 변경 통계
- PR에 포함된 변경 파일 경로와 상태
- 현재 비동기 분석 handoff가 제공하는 파일별 patch snippet
- 기존 파일별 위험도, 변경 이유, 변경 요약, review point 분석 결과

### 출력

- 변경 파일의 정규화된 역할
- 기능 단위의 복수 Review Flow
- Flow별 파일 membership과 리뷰 순서
- 변경 파일 사이의 의미 관계 type, reason, source, confidence
- 검증을 통과한 relation edge를 포함한 PR Review canvas read model
- 위험도, 리뷰 상태와 Conflict 상태를 유지하는 lane/cluster layout

### 제외

- 변경되지 않은 저장소 파일을 graph node로 추가
- 저장소 전체 dependency graph 탐색
- 변경 파일의 전체 content를 추가 조회하는 정밀 분석
- 사용자의 node/edge 편집과 review order 변경
- node 위치 저장과 여러 기기 간 복원
- Canvas DB/API persistence와 협업 annotation
- 기존 완료 session graph의 backfill

## 현재 기준선

- AI output은 `flowTitle`, `flowDescription` 한 쌍과 파일별 metadata만 반환한다.
- App Server는 session마다 review flow 한 개를 생성하고 모든 변경 파일을 입력 순서로 연결한다.
- Canvas API edge는 인접한 `workflowOrder` 파일을 `리뷰 순서` reason으로 연결한다.
- Frontend는 파일 경로와 역할 문자열로 `entry/data/logic/verification/support` 단계를 추론한다.
- 저장된 semantic relation이 없는 기존 session은 현재 순차 edge를 계속 사용해야 한다.

## 공통 원칙

- PR Review DB가 workflow graph의 source of truth다.
- Canvas DB/API와 자유형 shape 저장 경로를 사용하지 않는다.
- deterministic 분석이 관계의 사실 후보를 만들고 AI는 의미와 설명을 보강한다.
- AI output을 그대로 저장하지 않고 App Server validator를 통과시킨다.
- 근거가 부족한 관계는 억지로 만들지 않는다.
- relation이 없어도 모든 변경 파일은 graph에 남아야 한다.
- 같은 입력은 같은 검증 결과와 deterministic layout을 만들어야 한다.
- 기존 비동기 SQS, 전용 Worker, internal handoff 경계는 유지한다.
- 기존 Conflict, file decision, Review 제출과 Merge 동작을 바꾸지 않는다.

## 권장 PR 분할

1. `3-A`: Graph 계약과 관계 저장 모델 (`#773`)
2. `3-B`: Deterministic 관계 후보와 Flow grouping
3. `3-C`: AI 보강과 서버 graph validator
4. `3-D`: Frontend lane/cluster layout과 edge reason UX

각 단계는 별도 작업 Issue, branch와 PR로 진행한다. API/DB/기존 동작 변경 전에는
구현안을 사용자에게 설명하고 승인을 받은 뒤 수정한다.

## 3-A Graph Contract and Relation Model (#773)

목표:

- 후속 분석과 UI가 공유할 semantic graph 계약과 저장 모델을 먼저 확정한다.

작업 체크리스트:

- [x] 정규화 역할은 `entry`, `core_logic`, `api_contract`, `ui_state`, `verification`,
  `support`, `unknown`으로 두고 기존 자유 문자열 `fileRole` 설명을 유지한다.
- [x] relation type을 `depends_on`, `tests`, `uses_api`, `passes_data_to`, `supports`로
  확정한다.
- [x] relation source를 `rule`, `ai`, `hybrid`로 확정한다. 1차 AI는 rule 후보 밖의
  relation endpoint와 type을 새로 만들 수 없다.
- [x] confidence는 `0..100` 정수로 저장하고 Canvas에는 `60` 이상만 노출한다. 숫자는
  사용자 UI에 직접 표시하지 않는다.
- [x] Flow-scoped `review_flow_relations` table의 column, FK, unique constraint와 index를
  확정한다. raw patch와 code evidence는 저장하지 않는다.
- [x] relation이 같은 session과 Flow에 속한 두 review file만 연결하도록 DB 제약을 둔다.
- [x] session 삭제 시 relation이 cascade 삭제되도록 한다.
- [x] Canvas API의 semantic edge response에 type, reason, source, confidence를 정의한다.
- [x] semantic relation이 없는 기존 session의 순차 edge fallback을 유지한다.
- [x] 기존 session backfill을 하지 않고 새 분석 session부터 적용하는 정책을 문서화한다.
- [x] migration, API 문서, repository query와 contract 테스트를 함께 반영한다.

### 3-A 구현 전 승인 항목

아래 값은 임의로 확정하지 않고 구현 직전에 사용자 확인을 받는다.

- [x] relation type 최종 목록과 사용자 표시 문구
- [x] confidence 저장 형식과 최소 허용값
- [x] relation은 1차에서 같은 session의 Flow 내부 membership에 종속시킨다.
- [x] 동일 파일 쌍의 여러 relation type은 허용하고 같은 type 중복만 금지한다.
- [x] semantic edge가 있는 Flow는 semantic edge만 사용하고 순차 edge는 fallback으로만
  사용한다.

완료 기준:

- [x] 후속 PR이 schema를 다시 해석하지 않고 relation을 생성·검증·렌더링할 수 있다.
- [x] API와 DB가 같은 session/Flow/file 관계 무결성을 보장한다.
- [x] 기존 session canvas 응답과 화면이 깨지지 않는다.

## 3-B Deterministic Candidates and Flow Grouping

목표:

- 변경 파일 경로와 patch에서 설명 가능한 역할·관계 후보를 생성한다.

작업 체크리스트:

### 3-B1 File Roles and Core Relations (#776)

- [x] file role inference를 App Server PR Review 독립 모듈로 분리한다.
- [x] test 파일과 대상 파일의 경로·이름 관계를 추론한다.
- [x] patch의 추가·문맥 줄에 명시된 상대 import 관계만 후보로 인정한다.
- [x] API contract와 client/UI 사용 관계 후보를 만든다.
- [x] 삭제된 import, path alias와 해석할 수 없는 경로는 관계로 만들지 않는다.
- [x] 각 후보에 안전한 evidence, `rule` source와 confidence를 부여한다.
- [x] 관계를 deduplicate하고 같은 입력에서 같은 순서로 반환한다.
- [x] Python/Java 등 TypeScript 외 테스트 파일명 규칙도 최소 지원한다.

### 3-B2 Support Relations and Flow Grouping (#777)

- [x] migration/config/docs 파일의 support 관계 후보를 만든다.
- [x] 같은 기능 경로와 관계 연결성을 기준으로 Flow 후보를 만든다.
- [x] 어떤 Flow에도 묶이지 않은 파일을 fallback Flow에 보존한다.
- [x] package manifest/lockfile의 명시적 support 관계를 만든다.
- [x] 모든 변경 파일이 정확히 하나 이상의 Flow에 포함되도록 한다.

완료 기준:

- [x] OpenAI 호출 없이 고정 fixture에서 동일한 role/core relation 후보를 만든다.
- [x] 존재하지 않는 file path와 self edge를 생성하지 않는다.
- [x] 모든 변경 파일이 정확히 하나 이상의 Flow에 포함된다.

## 3-C AI Enrichment and Graph Validator

목표:

- AI가 후보 graph의 의미를 보강하고 서버가 저장 가능한 graph만 확정한다.

작업 체크리스트:

- [x] PR Review analysis strict JSON schema를 복수 Flow와 relation output으로 확장한다.
- [x] AI에는 deterministic 후보와 제한된 patch context만 전달한다.
- [x] AI가 새 file path를 발명하지 못하도록 입력 file path 집합으로 검증한다.
- [x] AI가 Flow 제목, 설명, relation reason과 리뷰 순서를 보강한다.
- [x] App Server validator가 self edge, 없는 파일, 중복 edge를 제거한다.
- [x] relation/Flow별 최대 edge 수와 전체 edge 수를 제한한다.
- [x] confidence가 기준보다 낮은 relation을 제거한다.
- [x] 순환 relation을 허용할 type과 리뷰 순서 cycle을 구분한다.
- [x] 검증 결과를 session, Flow, file membership, relation과 함께 원자 저장한다.
- [x] 동일 Job 재전달과 result 재전송에도 relation이 중복 생성되지 않게 한다.
- [x] invalid AI Graph output은 기본 분석을 유지하고 deterministic graph로 fallback한다.

완료 기준:

- [x] Worker와 App Server가 같은 versioned graph schema를 사용한다.
- [x] AI가 잘못된 edge를 반환해도 저장 graph는 서버 제약을 만족한다.
- [x] stale head SHA 결과가 Flow/file/relation을 저장하지 않는다.

## 3-D Lane/Cluster Layout and Edge UX

목표:

- 사용자가 기능 흐름과 파일 관계를 화면에서 읽을 수 있게 한다.

작업 체크리스트:

- [ ] 서버가 제공한 Flow와 file role을 lane/cluster 배치 입력으로 사용한다.
- [ ] `workflowOrder`를 node 번호와 주요 리뷰 경로로 표시한다.
- [ ] relation type별 edge style을 과도하지 않게 구분한다.
- [ ] edge hover 또는 선택 시 relation reason을 표시한다.
- [ ] semantic relation이 없는 기존 session은 현재 순차 layout을 유지한다.
- [ ] 독립 node와 fallback Flow가 화면 밖이나 다른 node와 겹치지 않게 한다.
- [ ] Conflict, 위험도와 review status badge를 기존과 동일하게 유지한다.
- [ ] 여러 Flow에 속한 파일의 중복 node 또는 membership badge 정책을 적용한다.
- [ ] 큰 PR에서 edge 수를 제한하고 canvas fit/zoom 성능을 확인한다.
- [ ] file node 선택과 diff drawer 진입 동작을 유지한다.

완료 기준:

- [ ] 사용자가 파일 관계, 관계 이유와 추천 리뷰 경로를 구분할 수 있다.
- [ ] desktop과 주요 viewport에서 node/edge/label이 겹치지 않는다.
- [ ] 기존 decision, Conflict resolution, Review 제출과 Merge 흐름이 동작한다.

## 검증 체크리스트

### App Server / DB

- [ ] migration apply와 rollback 검토를 완료한다.
- [ ] 같은 session/Flow에 속하지 않은 relation insert를 거부한다.
- [x] duplicate, self edge와 invalid type을 거부한다.
- [x] semantic graph 원자 저장과 idempotency 테스트가 통과한다.
- [ ] 기존 session 순차 edge fallback 테스트가 통과한다.
- [ ] `format:check`, `lint`, `build`, PR Review focused test가 통과한다.

### AI Worker

- [x] strict schema validation과 serializer 테스트가 통과한다.
- [x] 후보 graph 보강 성공과 invalid output 테스트가 통과한다.
- [ ] 없는 파일, 중복 relation, 과도한 edge output을 거부한다.
- [ ] Python format/lint/test와 image build가 통과한다.

### Frontend

- [ ] 복수 Flow, 독립 node, relation 없는 fallback fixture를 렌더링한다.
- [ ] edge reason과 relation type 표시 테스트가 통과한다.
- [ ] Conflict와 file decision 상태 회귀 테스트가 통과한다.
- [ ] `format:check`, `lint`, `build`, PR Review focused test가 통과한다.
- [ ] desktop/mobile screenshot으로 겹침과 canvas framing을 확인한다.

### Dev E2E

- [ ] API/서비스/UI 파일과 테스트가 함께 바뀐 PR을 분석한다.
- [ ] 복수 Flow와 의미 relation이 DB와 Canvas API에 저장된다.
- [ ] Review room에서 relation reason과 추천 리뷰 경로를 확인한다.
- [ ] graph가 불확실한 파일도 누락되지 않는다.
- [ ] 분석 재시도와 Worker 재시작 이후 같은 검증 규칙으로 graph가 저장된다.

## PR 생성 전 확인

- [ ] `AGENTS.md`, `convention.md`, `coding-rule.md`를 확인했다.
- [ ] `docs/api/README.md`, `docs/api/pr-review-api.md`를 확인했다.
- [ ] `apps/frontend/FRONTEND_COMMON_AREAS.md`를 확인했다.
- [ ] `apps/app-server/APP_SERVER_COMMON_AREAS.md`를 확인했다.
- [ ] API 계약, DB schema, Infra/env, 공통 영역 변경 여부를 PR 본문에 적었다.
- [ ] PR Review, DB Schema, GitHub Integration, Canvas 담당 확인이 필요한 변경을 명시했다.
- [ ] 실행한 검증과 미수행 검증의 사유를 PR 본문에 적었다.
