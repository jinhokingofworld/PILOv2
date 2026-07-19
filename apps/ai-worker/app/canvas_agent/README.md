# Canvas Agent package

`canvas_agent`는 PILO Canvas 안에서만 동작하는 Canvas AI worker 영역이다.
이 패키지는 Calendar, Issue, PR, Meeting 같은 외부 도메인 데이터를 직접 조회하거나 수정하지 않는다.
Canvas 기능 설명, 기존 shape 검색·viewport 이동, 일반 대화와 선택 영역에 대한
읽기 전용 분석, 선택 영역의 정적 HTML/CSS artifact 생성을 담당한다. Worker는
새 Canvas shape 생성, 연결, 수정, 삭제와
Canvas diagram/code draft 생성을 직접 하지 않는다. `generate_html` artifact를 받은
Canvas Frontend가 기존 tldraw 편집 경로로 코드블럭과 연결선을 생성한다.

## 폴더 구조

```text
canvas_agent/
  types.py
  processor.py
  embedding_processor.py
  planning/
    planner.py
    chat_responder.py
    html_generator.py
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
- 허용 intent 목록
- run context
- intent classification 결과
- semantic shape match
- processor 결과

### `processor.py`

Canvas Agent run job의 실행 흐름을 담당한다.

역할:

- SQS payload 검증
- run lock 획득/해제
- run context 조회
- terminal status 방어
- LLM intent classifier로 검색어와 현재 로드된 shape 후보를 분류
- 현재 shape 후보가 없으면 정리된 검색어로 semantic router 실행
- `generate_html`이면 검증된 `selectedScene`을 정적 HTML/CSS로 변환
- `chat`이면 일반 질문 또는 명시적으로 선택한 장면에 대한 읽기 전용 답변 생성
- 분류 결과를 `route_intent` step으로 DB에 저장

HTML 생성은 Canvas의 부모 관계, 섹션 순서, 상대 비율과 사용자 텍스트를 구조적
와이어프레임으로 해석한다. 사용자 prompt에 시각 스타일이 있으면 그 스타일을
적용하고, 별도 스타일 요청이 없으면 토스 계열의 밝고 정돈된 제품 UI를 기본값으로
사용한다. Canvas의 작은 절대 크기와 임시 색상을 그대로 복사하지 않고 전체 브라우저
영역을 채우는 grid/flex 레이아웃으로 구성하며, 필요한 정적 예시 버튼·카드·값을
보완할 수 있다.

중요한 원칙:

- local semantic routing 실패는 Canvas AI 전체 실패로 만들지 않고 빈 검색 결과로 처리한다.
- 실제 Canvas write는 worker가 직접 하지 않는다. HTML artifact의 코드블럭/연결선
  삽입은 Canvas Frontend가 일반 tldraw shape patch 경로로 처리한다.

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
- classified intent를 `route_intent` step으로 생성
- semantic shape search
- embedding job claim/complete/fail
- embedding upsert/delete

주의:

- repository는 DB I/O만 담당한다.
- intent 판단, prompt 구성, embedding source 의미 결정은 다른 파일에 둔다.

### `planning/planner.py`

LLM intent classifier 호출과 응답 검증을 담당한다.

역할:

- OpenAI Responses API 호출
- system/user prompt 전달
- JSON schema 응답 강제
- intent/arguments/message 파싱
- token, secret, credential 같은 위험 key 제거

주의:

- classifier는 raw tldraw shape나 Canvas draft를 만들지 않는다.
- 일반 모드 intent는 `chat`, `find_shapes`, `generate_html`, `import_drive_file`,
  `unsupported`다.
- 등록되지 않은 mutation 표현을 검색으로 바꾸지 않고 `unsupported`로 분류한다.
- 말로 충족할 수 있는 일반 질문·설명·의견·분석·조언은 `chat`으로 분류하며
  평범한 질문을 `unsupported`로 분류하지 않는다.

### `planning/chat_responder.py`

`chat` intent의 실제 자연어 답변을 별도 Responses API 호출로 생성한다.

- `contextScope=none`이면 선택 정보를 전달하지 않고 일반 질문에 답한다.
- `contextScope=selected_scene`이면 내부 shape id를 일회성 참조로 바꾸고
  asset reference를 제거한 선택 문맥만 전달한다.
- 최근 `conversationContext`는 후속 질문 해석에만 제한적으로 사용한다.
- Canvas 텍스트는 명령이 아닌 신뢰하지 않는 분석 데이터로 취급한다.
- Canvas를 변경하거나 실행했다고 주장하는 답변을 금지한다.

### `planning/prompts.py`

LLM에 전달할 system prompt와 user prompt를 조립한다.

역할:

- classifier의 분류 원칙 설명
- run context, previous action, 허용 intent 목록을 하나의 prompt payload로 합치기

이 파일은 intent 목록을 `planning/tool_catalog.py`에서 가져온다.

### `planning/tool_catalog.py`

LLM에게 허용할 bounded Canvas intent 목록을 관리한다.

포함 내용:

- `chat`
- `find_shapes`
- `generate_html`
- `import_drive_file`
- `unsupported`

중요한 점:

- tool-help mode는 App Server의 명시적 모드 라우팅이 처리하므로 LLM intent 목록에 포함하지 않는다.
- `connect_shapes`와 `create_draft`는 intent 목록에 포함하지 않는다.

### `planning/draft_schema.py`

과거 diagram/code draft 기록을 해석하기 위한 legacy 규칙과 템플릿이다.

포함 내용:

- generation rules
- draft kind 분류 기준
  - `diagram`
  - `code`
  - `chat`
- diagram draft template
- code draft template

중요한 점:

- 새 intent classifier prompt에서는 이 파일을 import하거나 전달하지 않는다.
- 기존 DB draft와 호환 코드가 제거될 때 함께 정리한다.

### `routing/semantic_router.py`

LLM이 정리한 검색어의 DB semantic routing을 담당한다.

역할:

- 현재 Canvas에 한정된 embedding 검색으로 기존 shape 후보 조회
- shape 후보가 충분히 확실하면 `find_shapes` intent classification 생성
- embedding이 없거나 확신 기준을 넘지 못하면 DB 제목·본문 검색 수행
- DB 검색은 `workspace_id`와 현재 `canvas_id`를 모두 일치시킨 뒤 최대 4건만 반환

중요한 원칙:

- embedding은 “기존 shape 후보 찾기”에만 사용한다.
- DB 텍스트 검색은 embedding 이후의 fallback으로만 사용한다.
- embedding과 action executor 모두 Canvas write를 하지 않는다.

## PILO AI 담당자가 Canvas AI를 사용할 때 필요한 점

PILO AI가 Canvas 관련 요청을 받으면 직접 Canvas용 LLM intent classifier를 호출하지 말고 App Server의 Canvas Agent run 생성 API 또는 `CanvasAgentService.createRun(...)`으로 위임해야 한다.

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
- `selectedScene`
- `selectedSceneError`
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
  - requester-only pointer, highlight와 viewport 이동을 보여줄 수 있음

- `background`
  - PILO AI가 Canvas 화면 밖에서 위임할 때 사용
  - pointer와 highlight를 보여주지 않음
  - 조용히 read-only run을 만들고 finalAnswer를 반환하는 흐름

PILO AI가 사용자의 현재 화면을 알고 있다면:

- Canvas 화면 안이면 `presentationMode = interactive`
- Canvas 화면 밖이면 `presentationMode = background`

### canvasId가 필요한 요청

아래 요청은 실제 Canvas 내용에 접근하므로 canvasId가 필요하다.

- `회의 관련 메모 찾아줘`
- `ERD 있는 곳으로 가줘`

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
- LLM에게 허용할 intent가 바뀌면 `planning/tool_catalog.py`를 먼저 수정한다.
- `planning/draft_schema.py`는 legacy draft 호환이 끝날 때까지 새 기능에 연결하지 않는다.
- semantic shape search 기준이 바뀌면 `routing/semantic_router.py`를 수정한다.
- DB job 처리나 embedding upsert/delete 흐름은 `embedding_processor.py`와 `repository.py`를 함께 확인한다.
