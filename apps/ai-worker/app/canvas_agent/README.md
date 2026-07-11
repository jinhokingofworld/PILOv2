# Canvas Agent package

`canvas_agent`는 PILO Canvas 안에서만 동작하는 Canvas AI worker 영역이다.
이 패키지는 Calendar, Issue, PR, Meeting 같은 외부 도메인 데이터를 직접 조회하거나 수정하지 않는다.
Canvas 기능 설명, Canvas 위 shape 검색, 기존 shape 연결, diagram/code draft 생성을 담당한다.

## 폴더 구조

```text
canvas_agent/
  types.py
  processor.py
  embedding_processor.py
  planning/
    planner.py
    prompts.py
    tool_catalog.py
    draft_schema.py
  routing/
    semantic_router.py
  embeddings.py
  repository.py
```

## 파일별 역할

### `types.py`

Canvas Agent worker에서 공유하는 dataclass와 상수를 둔다.

- Canvas Agent SQS job type/schema version
- 허용 action 목록
- run context
- planner 결과
- semantic shape match
- processor 결과

### `processor.py`

Canvas Agent run job의 실행 흐름을 담당한다.

역할:

- SQS payload 검증
- run lock 획득/해제
- run context 조회
- terminal status 방어
- semantic router 먼저 실행
- semantic router가 판단하지 못하면 LLM planner 실행
- planned action을 DB에 저장

중요한 원칙:

- local semantic routing 실패는 Canvas AI 전체 실패로 만들지 않고 LLM planner로 fall through 한다.
- 실제 Canvas write는 worker가 직접 하지 않고 App Server action executor가 처리한다.

### `embedding_processor.py`

Canvas shape embedding job을 처리한다.

역할:

- pending embedding job 조회
- 삭제 job이면 `canvas_agent_shape_embeddings`에서 제거
- upsert job이면 shape text source를 읽어 embedding 생성
- embedding 결과 저장
- 실패/완료 상태 기록

이 파일은 Canvas 위 shape 검색 품질을 위한 비동기 색인 처리 영역이다.

### `embeddings.py`

임베딩 모델 호출을 추상화한다.

역할:

- sentence-transformers 기반 embedder
- shape 검색용 source text 구성
- query embedding 생성
- shape embedding 생성

나중에 임베딩 모델을 교체해야 하면 우선 이 파일을 보면 된다.

### `repository.py`

Canvas Agent worker의 DB 접근 계층이다.

역할:

- run lock
- run context 조회
- planned action 생성
- semantic shape search
- embedding job claim/complete/fail
- embedding upsert/delete

주의:

- repository는 DB I/O만 담당한다.
- action 판단, prompt 구성, embedding source 의미 결정은 다른 파일에 둔다.

### `planning/planner.py`

LLM planner 호출과 응답 검증을 담당한다.

역할:

- OpenAI Responses API 호출
- system/user prompt 전달
- JSON schema 응답 강제
- actionName/inputJson/message 파싱
- token, secret, credential 같은 위험 key 제거

주의:

- planner는 raw tldraw shape를 만들지 않는다.
- planner는 Canvas action plan만 만든다.
- 실제 Canvas shape 생성은 App Server가 draft spec을 검증한 뒤 CanvasService를 통해 처리한다.

### `planning/prompts.py`

LLM에 전달할 system prompt와 user prompt를 조립한다.

역할:

- planner의 행동 원칙 설명
- run context, previous action, 도구 카탈로그, 생성 규칙을 하나의 prompt payload로 합치기

이 파일은 긴 데이터 목록을 직접 들고 있지 않고 아래 파일들을 import한다.

- `planning/tool_catalog.py`
- `planning/draft_schema.py`

### `planning/tool_catalog.py`

LLM에게 알려줄 Canvas 도구 목록과 색상 팔레트를 관리한다.

포함 내용:

- tldraw built-in 도구
  - frame
  - note
  - text
  - rectangle
  - circle
  - triangle
  - arrow
  - line
- PILO custom 도구
  - code
- Canvas에서 사용 가능한 색상
- planner가 선택할 수 있는 action 목록

중요한 점:

- code를 제외한 도구는 `tldraw_builtin`으로 설명한다.
- code는 `pilo_custom`으로 설명한다.
- LLM이 임의의 raw shape를 만들지 않고 지원 도구 안에서만 draft를 만들게 하는 기준 파일이다.

### `planning/draft_schema.py`

diagram/code draft 생성을 위한 규칙과 템플릿을 관리한다.

포함 내용:

- generation rules
- draft kind 분류 기준
  - `diagram`
  - `code`
  - `chat`
- diagram draft template
- code draft template

중요한 점:

- 사용자가 code/files/snippet/component/API/types를 요구하면 `kind=code`를 우선한다.
- 디자인, 흐름도, 와이어프레임, 사용자 여정, 구조도는 `kind=diagram`을 우선한다.
- 둘 다 아니면 `finish`로 대화형 답변을 만든다.

### `routing/semantic_router.py`

LLM 호출 전 로컬 semantic routing을 담당한다.

역할:

- 사용자가 기존 Canvas shape를 찾으려는 요청인지 판단
- “A와 B를 연결해줘”에서 A/B 후보를 embedding으로 찾기
- shape 후보가 충분히 확실하면 `find_shapes` 또는 `connect_shapes` plan 생성
- 애매하면 LLM planner로 넘김

중요한 원칙:

- embedding은 “기존 shape 후보 찾기”에만 사용한다.
- embedding이 직접 Canvas write를 하지 않는다.
- 실제 연결선 생성은 App Server action executor가 CanvasService를 통해 수행한다.

## PILO AI 담당자가 Canvas AI를 사용할 때 필요한 점

PILO AI가 Canvas 관련 요청을 받으면 직접 Canvas용 LLM planner를 호출하지 말고 App Server의 Canvas Agent run 생성 API 또는 `CanvasAgentService.createRun(...)`으로 위임해야 한다.

### 위임할 때 넘겨야 하는 정보

- `workspaceId`
- `canvasId`
- `currentUserId`
- 사용자 원문 `prompt`
- `source = general_agent_delegate`
- `parentAgentRunId`
- `requestContext`

`requestContext`에는 가능하면 아래 값을 넣는다.

- `selectedShapeIds`
- `viewport`
- `toolHelpMode`
- `presentationMode`

### prompt는 그대로 넘긴다

PILO AI는 사용자 문장을 요약하거나 영어 명령으로 바꾸지 않는다.

좋은 예:

- 사용자: `로그인 흐름을 캔버스에 다이어그램으로 만들어줘`
- Canvas AI prompt: `로그인 흐름을 캔버스에 다이어그램으로 만들어줘`

피해야 할 예:

- `create diagram login flow`처럼 재작성해서 넘기기
- PILO AI가 직접 Canvas shape 생성 방식을 판단하기
- PILO AI가 Canvas 기능 설명/단축키를 따로 하드코딩하기

### `toolHelpMode`

Canvas 기능 설명 질문이면 `requestContext.toolHelpMode = true`로 넘긴다.

예:

- `지우개 어디 있어?`
- `화살표 단축키 뭐야?`
- `화면 맞춤 어디 있어?`
- `자동 정렬 어디 있어?`

이 모드는 Canvas shape를 조회하거나 수정하지 않기 때문에 canvasId 없이도 답변 가능한 흐름으로 둘 수 있다.

### `presentationMode`

Canvas AI는 표시 방식을 두 가지로 나눈다.

- `interactive`
  - Canvas 화면 안에서 실행
  - requester-only pointer와 `toolSteps` playback을 보여줄 수 있음
  - draft preview/apply/discard UI를 보여주는 흐름

- `background`
  - PILO AI가 Canvas 화면 밖에서 위임할 때 사용
  - pointer와 `toolSteps` playback을 보여주지 않음
  - 조용히 run/draft를 만들고 finalAnswer를 반환하는 흐름

PILO AI가 사용자의 현재 화면을 알고 있다면:

- Canvas 화면 안이면 `presentationMode = interactive`
- Canvas 화면 밖이면 `presentationMode = background`

### canvasId가 필요한 요청

아래 요청은 실제 Canvas 내용에 접근하거나 수정하므로 canvasId가 필요하다.

- `회의 관련 메모 찾아줘`
- `ERD 있는 곳으로 가줘`
- `로그인 흐름 다이어그램 만들어줘`
- `이 두 도형 연결해줘`
- `JWT 예시 코드블럭 만들어줘`

canvasId가 없으면 PILO AI가 먼저 어느 Canvas에 적용할지 사용자에게 물어봐야 한다.

### finalAnswer 반환 방식

PILO AI는 Canvas AI가 만든 `finalAnswer`를 중계 문구 없이 그대로 사용자에게 반환한다.

좋은 예:

- `지우개는 그리기 메뉴 안에 있어요. 단축키는 E예요.`

피해야 할 예:

- `Canvas AI 기준으로 안내할게요. 지우개는...`
- `Canvas AI가 말하길...`

사용자 입장에서는 PILO AI와 자연스럽게 대화하지만, 내부 판단과 실행 기록은 Canvas AI run에 남는 구조가 맞다.

## 유지보수 기준

- Canvas 기능 설명/도구 정보는 Canvas AI 쪽에서 관리한다.
- PILO AI는 Canvas 세부 지식을 중복 관리하지 않는다.
- LLM에게 알려줄 Canvas 도구가 늘어나면 `planning/tool_catalog.py`를 먼저 수정한다.
- draft 생성 규칙이나 diagram/code 기준이 바뀌면 `planning/draft_schema.py`를 수정한다.
- semantic shape search 기준이 바뀌면 `routing/semantic_router.py`를 수정한다.
- DB job 처리나 embedding upsert/delete 흐름은 `embedding_processor.py`와 `repository.py`를 함께 확인한다.
