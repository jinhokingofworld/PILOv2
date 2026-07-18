# Agent Tool Discovery·Meeting Agent 개선 Plan

> 상태: DB migration 중에는 resource 해소·실행을 요구하는 Phase 1 통합 검증을 완료할 수 없다.
> 따라서 Phase 0에서 DB 비의존 Tool Discovery·평가 기반을 먼저 만들고, Phase 1~3의 Meeting
> resolver·candidate selection·thread memory 기반과 결합한다. Phase 4부터는 이를 전 도메인이
> 재사용하는 Tool 검색·의도/selector·multi-turn·평가 기반으로 확장한다.
>
> 작성 기준: 2026-07-17 AI Chat 수동 검증 결과
>
> 목표: 2026-07-17 검증 목록의 모든 Meeting 기능을 자연어로 정확히 처리하는 것을 첫 수용 기준으로 삼고,
> Calendar·Board·Canvas·SQLtoERD·Drive·PR Review까지 사용자의 발화를 잘 이해해 관련 tool을 검색하고,
> 내부 UUID 없이 안전한 selector와 multi-turn context로 실행하는 공통 Agent 기반을 완성한다.

## 1. 배경

현재 Meeting Agent는 회의방 목록, 회의 제어, 참여자·진행 시간 조회, 회의록·근거 조회,
후속작업 처리 tool을 제공한다. 하지만 지원 의도를 일관되게 분류하고, 자연어에서 대상을 해소하고,
필요한 tool을 연쇄 실행하는 과정이 불완전하다.

실제 검증에서는 다음 문제가 확인됐다.

- “EJ에서 진행되는 회의에 들어가줘”가 회의방 이름을 Meeting으로 연결하지 못했다.
- “현재 회의에서 나가줘”가 현재 참여 상태를 조회하지 않고 `meetingId`를 요구했다.
- “오늘 EJ 회의에 누가 참여했어?”가 회의방·날짜로 Meeting을 찾지 못했다.
- “어제 회의 결정사항과 후속 작업만 알려줘”가 기간으로 MeetingReport를 찾지 못했다.
- “가장 최근에 실패한 회의록은 왜 실패했어?”가 상태·최신순 조회 대신 `reportId`를 요구했다.
- “내가 맡은 회의 후속 작업”과 담당자 이름 검색이 특정 `reportId` 없이 동작하지 않았다.
- 직전 목록을 가리킨 “이 회의의 2번 후속 작업”이 `actionItemId`와 담당자 ID를 다시 요구했다.
- 나가기 성공 뒤에도 우측 상단 현재 회의 상태가 수동 새로고침 전까지 갱신되지 않았다.
- “지금 회의 몇 분째야?”는 `get_active_meeting`으로 답할 수 있는데도 처음에는 지원하지 않는 요청으로
  처리됐다.
- “최근 회의록”은 동작했지만 “어제 결정사항만”, “재시도한 회의록”, “후속 일정의 근거”처럼 같은
  데이터를 다른 관점으로 요청하면 tool 선택과 후속 연결이 흔들렸다.

따라서 이 Plan은 ID 해소만을 다루지 않는다. 검증 목록의 모든 기능을 대상으로 의도 인식,
resource 해소, 날짜·상태 해석, tool routing, 근거 답변, mutation orchestration, run 문맥,
Frontend 상태 갱신을 하나의 품질 기준으로 개선한다. Phase 4부터는 Meeting에서 검증한 패턴을
도메인 중립적인 Tool Discovery·Planning Intelligence 계약으로 끌어올려 다른 Agent tool에도 순차 적용한다.

## 2. 현재 코드에서 확인된 원인

### App Server

`apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts`의 현재 planner-facing schema는
다음 식별자를 직접 요구한다.

- `join_meeting`, `leave_meeting`, 녹음 시작·종료: `meetingId`
- `get_meeting_report`, `summarize_meeting_report`, 재생성: `reportId`
- 후속작업 조회·수정·승인·반려: `reportId`, `actionItemId`
- 후속작업 담당자 변경: `assigneeUserId`

개별 tool은 UUID를 안전하게 검증하지만, 그 앞에서 자연어를 resource로 바꾸는 공통 해소 경계가 없다.
또한 `list_meeting_reports`는 Agent 입력으로 `status`, `limit`만 받아 날짜·회의방·검색어를 직접
표현할 수 없고, `find_action_items`는 하나의 report를 먼저 지정해야 한다.

### AI Worker

`apps/ai-worker/app/agent_processor.py`에는 MeetingReport 상세·요약 요청에서 유효한 `reportId`가
없으면 tool call을 거부하는 검증과 prompt 규칙이 있다. 회의 제어 ID를 추측하지 말라는 안전 규칙은
필요하지만, 현재는 “조회 tool로 먼저 찾은 뒤 실행한다”가 아니라 “ID가 없으면 중단한다”로 이어진다.

### Frontend

Meeting runtime과 Realtime 갱신 경로는 존재하지만, Agent가 완료한 join/leave/recording 결과가
우측 상단 현재 회의 상태 재조회까지 이어지는지는 별도 검증이 필요하다. 수동 검증에서는 나가기 뒤
새로고침 전까지 이전 상태가 남았다. 정확한 원인은 구현 단계에서 완료 step 소비, runtime refresh,
Realtime invalidation 순서로 좁힌다.

## 3. 제품 원칙

1. `meetingRoomId`, `meetingId`, `reportId`, `actionItemId`, `assigneeUserId`는 내부 transport
   식별자다. Agent는 정상 답변, 보완 질문, confirmation에서 사용자에게 UUID를 요구하지 않는다.
2. 사용자는 회의방 이름, 현재 참여 상태, 상대 날짜, 상태, 담당자 이름, 제목, 직전 결과의 순번으로
   대상을 지정한다.
3. 결과가 하나면 Agent가 다음 tool을 자동 호출한다. 결과가 없을 때는 검색 조건을 설명하고, 둘 이상일
   때만 이름·일시·상태가 포함된 후보를 최대 3개 제시한다.
4. 후보 선택에는 raw ID 대신 사용자·Workspace·run에 묶인 `selectionToken`을 사용한다.
5. 같은 run의 bounded tool 결과와 `resourceRefs`는 대명사와 순번을 해소하는 데 재사용한다.
6. 해소한 resource는 각 tool 실행 직전에 현재 사용자와 Workspace 접근 권한을 다시 검증한다.
7. UUID가 없다는 이유만으로 `unsupported`를 반환하지 않는다. 일정 시각이나 delivery 대상처럼 실제
   업무 정보가 부족할 때만 사람에게 질문한다.
8. write confirmation, 녹음 동의, 멱등성, Workspace 격리는 기존 규칙을 유지한다.
9. Tool Matrix에 지원된 것으로 등록된 의도는 표현이나 조사·띄어쓰기·경미한 오타가 달라도 같은
   capability로 분류한다. 지원 tool이 있는데 `unsupported`로 끝내지 않는다.
10. 사용자가 요청한 출력 범위를 지킨다. “결정사항과 후속 작업만”에는 불필요한 전체 회의록을 붙이지
    않고, 근거 질문에는 연결된 transcript·Activity evidence만 사용한다.
11. 수동 검증에서 이미 성공한 기능도 regression 대상이다. 개선 과정에서 회의방 목록, 회의 시작,
    최근 회의록, 현재 참여 회의 조회가 퇴행하면 완료로 보지 않는다.

## 4. 범위

### 포함

- 수동 검증의 모든 `# 제목`에 대응하는 Meeting capability의 의도 인식과 tool routing
- 회의방 이름으로 active Meeting 찾기
- 현재 사용자가 참여 중인 Meeting 찾기
- 날짜·상태·최신순·회의방으로 Meeting과 MeetingReport 찾기
- 요청한 회의록 section만 추출하고 생성 상태·실패 원인을 설명하기
- 회의 발언과 Activity evidence로 후속 일정·결정사항의 근거를 답하기
- 현재 사용자 또는 구성원 이름으로 후속작업 찾기
- 직전 목록의 “이 회의”, “그 작업”, “2번” 해소
- 같은 Agent thread에서 이전 run의 회의·회의록·후속작업 참조를 이어 해소하는 bounded multi-turn memory
- 후속작업 수정·승인·반려의 연쇄 실행과 confirmation
- 자연어 후보 선택과 원래 요청 재개
- Agent 회의 상태 변경 뒤 Meeting header 즉시 갱신
- 성공·실패를 포함한 전체 수동 검증 발화의 자동 regression eval 전환
- 모든 Agent tool의 domain·action·사용 조건·인접 intent 반례를 담는 공통 capability descriptor
- 사용자 발화와 안전한 thread context로 관련 tool schema만 선별하는 공통 Tool 검색 계층
- Calendar·Board·Canvas·SQLtoERD·Drive·PR Review가 같은 intent/selector/contextRef 계약으로
  순차 등록될 수 있는 domain adapter 경계
- 현재 planner model baseline과 candidate model을 동일 suite에서 비용·지연시간까지 비교하는 평가 체계

### 제외

- Workspace·요청 사용자 경계를 넘는 기억 또는 무제한 장기 대화 보존
- Workspace 밖 resource 검색
- 전역 fuzzy search 또는 임의의 별칭 학습
- 사용자에게 UUID를 보여주거나 직접 입력하게 하는 검색 UI
- 각 도메인의 기존 API·DB 검증을 우회하는 범용 실행기 또는 tool mutation 권한 확대
- 평가와 capability descriptor 없이 모든 domain tool을 한 번에 모델에 노출하는 전면 전환
- 원문 사용자 발화, raw tool payload, UUID·token·secret을 운영 관측 데이터로 장기 보존하는 방식

기존 `agent_steps`의 bounded output과 `resourceRefs`로 run 문맥을 구성하는 것을 우선한다. DB schema나
공개 API 계약 변경이 필요해지면 구현을 멈추고 Meeting 담당자와 DB Schema 담당자 검토를 받는다.

## 5. 기능별 개선 범위

수동 검증의 `# 제목`을 아래 capability 계약으로 고정한다. 각 행은 단순히 tool이 등록되어 있다는
뜻이 아니라, 자연어 인식부터 최종 답변 또는 실행까지 성공해야 완료된 것으로 본다.

아래 표현은 고정 keyword 목록이 아니라 대표 발화군이다. 같은 의미의 어순·말투·생략·문맥 표현을
조합해도 동일 capability로 인식해야 한다.

| 검증 제목 | 대표 발화군 | 완료 동작 |
| --- | --- | --- |
| 회의방 목록과 방별 진행 상태 | “회의방 보여줘”, “방 뭐뭐 있어?”, “열려 있는 회의 있어?”, “지금 어디서 회의 중이야?”, “진행 중인 방만 알려줘”, “meeting room 상태 보여줘” | Workspace 회의방과 current Meeting 상태를 이름 중심으로 요약 |
| 회의방에서 회의 시작 | “Backend에서 시작해줘”, “EJ 방 회의 열어줘”, “백엔드 미팅 시작하자”, “그 방에서 바로 시작”, “회의 하나 파줘”, “start meeting in Frontend” | 방 해소, 동의·confirmation, 시작, 연결 action |
| 회의방 참여·재입장 | “EJ 회의 들어가줘”, “EJ 참석할게”, “그 회의 연결해줘”, “아까 회의 다시 들어갈래”, “회의에 복귀시켜줘”, “Backend meeting join” | active Meeting 해소, participant session 재사용, 연결 action |
| 회의방 나가기 | “현재 회의에서 나가줘”, “나 이제 나갈게”, “회의 퇴장”, “여기서 빠질래”, “내 회의 연결 끊어줘”, “leave meeting” | active Meeting 해소, leave, 마지막 참여자 영향 처리, UI 갱신 |
| 현재·과거 참여자 조회 | “오늘 EJ에 누가 참여했어?”, “지금 누가 있어?”, “참석자 명단 보여줘”, “누가 왔다 갔어?”, “어제 Frontend 참가 인원”, “현재 들어와 있는 사람만” | 방·날짜·상태로 Meeting을 찾아 현재·과거 참여자 구분 |
| 진행 중인 회의 시간 | “지금 몇 분째야?”, “몇 분쨰야?”, “시작한 지 얼마나 됐어?”, “언제 시작했지?”, “한 시간 넘었어?”, “회의 경과 시간 알려줘” | active Meeting의 `durationSec`를 읽기 쉬운 시간으로 표시 |
| 내가 참여 중인 회의와 방 | “내가 지금 어디 들어가 있지?”, “내 현재 회의 뭐야?”, “참여 중인 미팅 있어?”, “어느 방에 연결돼 있어?”, “지금 들어가 있는 거 보여줘” | 현재 Meeting, 회의방, 시작 시각·상태 표시 |
| 녹음 종료와 회의록 생성 | “녹음 끝내고 회의록 만들어줘”, “이제 녹음 마무리”, “recording stop하고 report 만들어”, “회의록 생성 돌려줘”, “녹음 끄고 정리해줘”, “지금 회의 기록 끝내자” | active Meeting 해소, recording 종료, report 생성 상태 안내 |
| 최근·상태별 회의록 | “최근 회의록”, “제일 최신 회의록”, “마지막으로 만든 거”, “다시 돌린 회의록”, “오류 난 회의록”, “생성 중인 것만”, “어제 완료된 report” | 상태·시간 조건으로 정렬해 맞는 report 목록 반환 |
| 특정 회의록 상세·생성 상태 | “최근 실패한 회의록이 왜 실패했어?”, “왜 안 만들어졌어?”, “어디서 오류 났어?”, “아직 생성 중이야?”, “완료된 거 맞아?”, “재시도할 수 있어?” | report 해소 후 상태, 안전한 실패 원인, 재시도 가능 여부 표시 |
| 요약·논의·결정·후속 작업 선택 조회 | “어제 결정사항과 후속 작업만”, “논의된 것만 정리해줘”, “결론만 말해줘”, “액션 아이템만 뽑아줘”, “요약 빼고 결정만”, “어제 회의 핵심이랑 할 일” | 날짜로 report를 찾고 요청한 section만 반환 |
| 회의 발언·실제 활동 근거 질문 | “후속 일정이 나온 근거가 뭐야?”, “왜 그렇게 정했지?”, “누가 그런 말을 했어?”, “근거 발언 보여줘”, “실제로 뭘 해서 결정됐어?”, “회의 내용이랑 활동 로그로 설명해줘” | 관련 transcript와 Activity evidence를 근거로 답변 |
| 결정사항 Activity evidence 검증 | “이 결정이 실제 활동과 맞아?”, “이 결론을 뒷받침하는 로그 있어?”, “말만 한 건지 확인해줘”, “그 결정의 Activity 근거”, “실제로 작업한 흔적도 보여줘” | 같은 decision item에 직접 연결된 evidence만 표시 |
| 담당 후속 작업 검색 | “내가 맡은 것”, “내 할 일 뭐 남았어?”, “김진호의 미승인 작업”, “세인 담당 액션 아이템”, “담당자가 나인 후속 작업만”, “진호가 할 거 있어?” | report 지정 없이 담당자·상태·기간으로 검색 |
| 후속 작업 수정·승인·반려 | “2번을 김세인에게 넘기고 승인”, “담당자를 세인으로 바꿔줘”, “이 작업 승인 처리”, “그건 반려해”, “우선순위 높여줘”, “두 번째 액션 아이템 제외해줘” | 문맥·순번·담당자 해소, 변경 preview, confirmation, 멱등 실행 |

### 공통 발화 변형 축

각 capability의 eval은 대표 문장만 복사하지 않고 아래 축을 교차 조합한다.

| 변형 축 | 반드시 포함할 범위 | 예시 |
| --- | --- | --- |
| 말투·종결 | 명령, 부탁, 질문, 희망, 구어체, 존댓말·반말 | “보여줘”, “볼 수 있을까요?”, “알고 싶어”, “좀 찾아봐”, “있나?” |
| 주어·목적어 생략 | 동작이나 대상 일부를 직전 문맥에서 복원 | “들어갈게”, “나가줘”, “누구 있었지?”, “몇 분 됐어?” |
| 대명사·담화 참조 | 현재·직전 대상과 순번을 같은 run에서 연결 | “이 회의”, “그거”, “방금 거”, “아까 회의”, “두 번째 것” |
| 어순·조사 | 한국어 어순 변경과 조사 생략·교체 | “김진호가 맡은 작업”, “후속 작업 중 진호 담당”, “EJ 오늘 참여자” |
| 시간 표현 | 절대·상대·범위·최신순 표현 | “오늘”, “어제”, “그제”, “지난 회의”, “방금”, “가장 최근”, “이번 주” |
| 상태 표현 | enum 이름이 아닌 일상 표현 | “진행 중”, “끝난”, “만드는 중”, “실패한”, “오류 난”, “다시 돌린” |
| 표기 변형 | 띄어쓰기, 붙여쓰기, 경미한 오타, 문장부호 없음 | “회의록보여줘”, “후속작업”, “몇 분쨰”, “재시도한거뭐야” |
| 한영 혼용 | 고유 방 이름과 익숙한 도메인 용어의 혼용 | “Backend 미팅”, “meeting join”, “report 상태”, “action item 승인” |
| 복합 요청 | 서로 호환되는 조회 또는 순차 작업을 한 문장에 결합 | “누가 들어와 있고 몇 분 됐어?”, “담당자 바꾸고 승인해줘” |
| 정정·후속 입력 | 앞선 조건을 취소하거나 좁혀 같은 run을 갱신 | “아니 어제 말고 오늘”, “그중 EJ만”, “2번 말고 마지막 거” |

경미한 오타 허용은 의미가 안정적인 경우에 한한다. 회의방·구성원 이름이 실제 다른 resource와
충돌하거나 write 대상이 달라질 수 있으면 추측하지 않고 사람이 읽을 수 있는 후보를 제시한다.

### 도메인 표현 사전

이 표는 keyword 일치 규칙이 아니라 paraphrase 생성과 entity 정규화를 위한 seed다. 한 단어만 보고
intent를 결정하지 않고, 문장 전체의 동작·대상·상태·문맥을 함께 본다.

| 개념 | 함께 인식할 표현 |
| --- | --- |
| 회의방 | 회의방, 방, 회의실, 미팅룸, room, 채널, 공간 |
| 회의 | 회의, 미팅, meeting, 콜, call, 통화, 세션, 모임 |
| 참여 | 들어가다, 참여하다, 참석하다, 접속하다, 연결하다, 합류하다, 복귀하다, 재입장하다, join |
| 퇴장 | 나가다, 빠지다, 퇴장하다, 연결을 끊다, 통화에서 나오다, leave |
| 시작 | 시작하다, 열다, 개설하다, 만들다, 파다, kickoff, start |
| 진행 상태 | 진행 중, 열려 있음, 시작됨, active, 현재 회의 중, 끝남, 종료됨, closed |
| 녹음 | 녹음, recording, 기록, 음성 기록, 레코딩, egress |
| 회의록 | 회의록, 미팅 기록, 회의 정리, 요약본, report, 리포트, 결과 문서 |
| 생성 상태 | 만드는 중, 처리 중, 대기 중, 완료, 성공, 실패, 오류, 에러, 다시 생성, 재시도 |
| 요약 section | 요약, 핵심, 한줄 정리, 개요, summary |
| 논의 section | 논의, 이야기한 것, 대화 내용, 논점, discussion |
| 결정 section | 결정, 결론, 합의, 확정된 것, decision |
| 후속 작업 | 후속 작업, 할 일, 해야 할 것, 액션 아이템, action item, task, TODO |
| 담당자 | 담당, 맡은 사람, assignee, 오너, owner, 책임자 |
| 승인 | 승인, 확정, 진행 처리, 채택, approve, 오케이 처리 |
| 반려 | 반려, 기각, 제외, 취소, 하지 않기로, dismiss |
| 근거 | 근거, 이유, 배경, 왜, 발언, 출처, evidence, 활동 로그, 실제 작업 흔적 |
| 현재 사용자 | 나, 내, 내가, 제, 저, 본인, 현재 사용자 |
| 최신 | 최근, 최신, 마지막, 제일 새것, 방금 만든, 가장 나중, latest |
| 순번 | 1번, 첫 번째, 첫째, 맨 위, 2번, 두 번째, 둘째, 마지막, 맨 아래 |

### 기능별 추가 eval 발화

아래 문장들은 앞의 대표 발화군과 중복되지 않는 추가 seed다. capability별로 일부는 현재 run의
직전 문맥이 있어야 하며, 문맥이 없으면 raw ID가 아니라 자연어 후보를 요청해야 한다.

#### 회의방 목록과 방별 진행 상태

- “쓸 수 있는 회의실 목록 알려줘”
- “우리 팀 미팅룸이 몇 개야?”
- “현재 열려 있는 회의방만 볼래”
- “회의 중인 채널이 있는지 확인해줘”
- “각 방마다 지금 회의하는지 붙여서 보여줘”
- “빈 방이랑 사용 중인 방 구분해줘”
- “workspace meeting rooms 보여줄래?”
- “지금 active인 room부터 정리해줘”
- “어느 방이 돌아가고 있어?”
- “회의방현황좀”

#### 회의방에서 회의 시작

- “Frontend 방에서 지금 회의 시작해줘”
- “Backend 미팅룸 열고 회의 시작하자”
- “EJ를 회의방으로 잡아서 시작해줘”
- “그 방에서 새 미팅 만들어줘”
- “방금 고른 회의실에서 바로 열어줘”
- “백엔드 채널에 콜 하나 파줘”
- “Frontend room으로 meeting start 부탁해”
- “EJ방회의시작해줘”
- “지금 백엔드 회의 개설해줄래?”
- “세 번째로 보여준 방에서 회의 열어줘”

#### 회의방 참여·재입장

- “지금 EJ에서 하는 미팅에 합류해줘”
- “Backend 콜로 연결해줘”
- “아까 나왔던 회의 다시 접속할게”
- “내가 방금 있던 미팅으로 복귀시켜줘”
- “Frontend 회의 참석할래”
- “현재 열려 있는 EJ 방에 붙여줘”
- “그 meeting에 join 시켜줘”
- “백엔드회의들어가자”
- “조금 전에 끊긴 회의 재입장해줘”
- “첫 번째 진행 중인 회의로 연결해줘”

#### 회의방 나가기

- “지금 들어가 있는 데서 빼줘”
- “현재 통화 종료하고 나갈래”
- “이 미팅에서는 퇴장할게”
- “나 회의에서 빠질게”
- “연결된 meeting leave 해줘”
- “방금 들어간 회의 다시 나가줘”
- “현재 세션 연결을 끊어줘”
- “회의나갈게”
- “이 방에서 나만 퇴장시켜줘”
- “참여 중인 콜에서 나오게 해줘”

#### 현재·과거 참여자 조회

- “EJ 회의 참석자가 누구였지?”
- “오늘 백엔드 방에 들어왔던 사람 전부 보여줘”
- “현재 Frontend 미팅 멤버 알려줘”
- “아까 그 회의에 누가 있었어?”
- “지금 접속해 있는 참가자만 알려줘”
- “어제 회의 왔다 간 사람까지 포함해줘”
- “그 미팅 participant 목록 보여줘”
- “EJ참석자누구야”
- “오늘 오전에 열린 Backend 회의 인원 알려줘”
- “두 번째 회의의 현재·과거 참석자 구분해줘”

#### 진행 중인 회의 시간

- “이 회의 얼마나 오래 했어?”
- “지금 미팅 경과 시간이 어떻게 돼?”
- “몇 시부터 시작한 거야?”
- “시작하고 얼마나 흘렀지?”
- “현재 콜 한 지 몇 분 됐어?”
- “회의 30분 넘었는지 봐줘”
- “meeting duration 알려줘”
- “몇분째진행중이야”
- “아까 시작한 회의 아직 한 시간 안 됐지?”
- “지금 회의 시작 시각이랑 지난 시간 같이 보여줘”

#### 내가 참여 중인 회의와 방

- “내가 연결된 meeting 찾아줘”
- “지금 내 참여 상태가 어떻게 돼?”
- “나 현재 회의 중이야?”
- “내가 있는 회의방 이름 알려줘”
- “지금 참석 중인 세션 보여줘”
- “내 active meeting이 뭐지?”
- “나어느방이야”
- “현재 내가 붙어 있는 콜 있어?”
- “내가 회의에 들어가 있으면 시작 시간도 알려줘”
- “내 현재 미팅과 room 상태 확인해줘”

#### 녹음 종료와 회의록 생성

- “현재 회의 레코딩 종료하고 리포트 요청해줘”
- “이제 음성 기록 닫고 회의 정리 만들어줘”
- “지금 recording을 끝낸 다음 회의록 생성해줘”
- “녹음 중지하고 결과 문서 뽑아줘”
- “현재 미팅 기록 마감해줘”
- “그 회의 녹음을 끝내고 report job 시작해줘”
- “레코딩끝내고회의록만들어”
- “방금 회의 음성 기록 종료 처리해줘”
- “이제 녹음은 그만하고 요약본 만들어줘”
- “회의 녹화 종료 후 회의록 생성 상태도 알려줘”

#### 최근·상태별 회의록

- “가장 마지막 회의 정리 보여줘”
- “방금 생성된 report가 뭐야?”
- “완료된 회의록만 최신순으로 보여줘”
- “아직 처리 중인 회의록 있어?”
- “에러 난 미팅 리포트 목록 줘”
- “다시 생성 요청한 것 중 제일 최근 거”
- “어제 만들어진 회의록 전부 찾아줘”
- “이번 주 최신 회의 기록 보여줘”
- “최근회의록뭐있어”
- “실패했다가 재시도된 report가 있나?”

#### 특정 회의록 상세·생성 상태

- “방금 그 회의록 처리 상태 자세히 보여줘”
- “최근 리포트가 완료됐는지 확인해줘”
- “실패 단계가 어디였어?”
- “회의록 생성이 멈춘 이유를 알려줘”
- “다시 만들 수 있는 상태야?”
- “아까 실패한 report 상세 보여줘”
- “그거 아직 pending이야?”
- “왜회의록안나와”
- “마지막 재시도 결과가 성공인지 실패인지 알려줘”
- “두 번째 회의록의 생성 시각과 상태를 보여줘”

#### 요약·논의·결정·후속 작업 선택 조회

- “최근 회의의 핵심 요약만 세 줄로 알려줘”
- “어제 무슨 얘기했는지만 보여줘”
- “결정된 내용만 따로 모아줘”
- “후속 작업 후보만 번호로 정리해줘”
- “논의사항하고 결론을 나눠서 보여줘”
- “할 일은 빼고 요약만 알려줘”
- “summary 없이 action item만 줘”
- “어제회의결정만”
- “마지막 회의에서 확정된 것과 담당 업무를 알려줘”
- “두 번째 report의 논의·결정 section만 보여줘”

#### 회의 발언·실제 활동 근거 질문

- “그 일정이 왜 후속 작업으로 잡혔어?”
- “누가 어떤 말로 이 할 일을 제안했어?”
- “회의에서 나온 정확한 맥락을 알려줘”
- “실제 활동 기록까지 보면 왜 이런 결론이야?”
- “이 액션 아이템의 출처가 되는 발언 찾아줘”
- “말한 내용과 실제 작업을 함께 근거로 보여줘”
- “그거 왜하기로한거야”
- “어제 회의의 TODO가 만들어진 배경 설명해줘”
- “후속 일정 날짜가 정해진 이유를 근거와 같이 알려줘”
- “두 번째 작업에 연결된 transcript와 Activity만 보여줘”

#### 결정사항 Activity evidence 검증

- “이 결론에 직접 연결된 활동이 있어?”
- “결정하고 실제로 작업했는지 확인해줘”
- “이 decision의 근거 로그만 보여줘”
- “회의에서 정한 내용이 코드 활동에도 나타나?”
- “그 결정에 연결된 transcript와 activity를 분리해줘”
- “직접 evidence가 없으면 없다고 말해줘”
- “이결정근거있어”
- “어제 두 번째 결정이 실제 행동으로 이어졌나?”
- “결정별로 근거가 있는지 검증해줘”
- “다른 결정 말고 선택한 결론의 활동 흔적만 줘”

#### 담당 후속 작업 검색

- “내 미완료 액션 아이템 보여줘”
- “내 이름으로 배정된 회의 할 일 있어?”
- “세인님 담당인 pending 작업만 찾아줘”
- “진호가 맡았는데 승인 안 된 것 보여줘”
- “담당자 없는 후속 작업도 있어?”
- “어제 회의에서 내가 해야 하는 거 뭐야?”
- “my action items from meetings”
- “내할일남은거”
- “이번 주 회의에서 은재 오너인 task 찾아줘”
- “최근 회의들의 담당자별 후속 작업을 묶어줘”

#### 후속 작업 수정·승인·반려

- “첫 번째 후속 작업 담당자를 나로 바꿔줘”
- “그 할 일 우선순위를 HIGH로 올려줘”
- “두 번째 액션 아이템 설명을 이 내용으로 수정해줘”
- “아까 본 작업을 승인 처리해줘”
- “마지막 TODO는 기각해줘”
- “세인에게 넘긴 다음 승인까지 진행해줘”
- “이 task는 하지 않기로 했으니 반려해줘”
- “2번담당진호로바꾸고승인”
- “방금 승인한 건 말고 세 번째 것만 수정해줘”
- “내 담당으로 변경하고 금요일 일정으로 승인해줘”
- “우선순위를 낮추고 Board issue로 만들어줘”
- “그 후속 작업 제목 고친 뒤 승인 요청해줘”

### 복합·연속 대화 eval 발화

한 문장에 여러 read가 있거나 앞선 결과를 이어 쓰는 경우도 별도 scenario로 검증한다.

| 순서 | 사용자 발화 | 기대 흐름 |
| --- | --- | --- |
| 1 | “지금 EJ에서 누가 회의 중이고 시작한 지 얼마나 됐어?” | room/Meeting 해소 → 참여자 + 경과 시간 조회 |
| 2 | “내가 들어가 있는 방이랑 현재 참가자 알려줘” | active Meeting → 방 + 참여자 조회 |
| 3 | “어제 회의 결정이랑 내 후속 작업만 보여줘” | 날짜별 report → decision + `me` action item 조회 |
| 4 | “최근 실패한 회의록 원인 보고 다시 생성해줘” | 실패 report → 상세 → 재생성 confirmation |
| 5 | “EJ 회의 들어갔다가 끝나면 나갈 수 있게 연결해줘” | 현재 의도는 join만 실행, 미래 자동 leave는 지원하지 않음을 안내 |
| 6 | “현재 회의에서 나가고 Backend 회의로 들어가줘” | active Meeting → switch 영향 confirmation → leave + join |
| 7 | “그 회의록 후속 작업 보여줘” → “두 번째 거 세인한테 넘겨” | report refs 유지 → ordinal + member 해소 → update confirmation |
| 8 | “어제 회의록” → “아니 그제 거” → “결정만” | 날짜 조건 정정 → 동일 run report 재해소 → decision projection |
| 9 | “실패한 회의록 보여줘” → “그중 최신 거 왜 실패했어?” | 목록 refs + 최신순 → detail |
| 10 | “내 후속 작업 알려줘” → “승인된 건 빼고” | assignee 유지 → status 조건 갱신 |
| 11 | “김진호 작업 보여줘” → “아니 김세인” | member 조건 교체, 이전 member를 함께 적용하지 않음 |
| 12 | “이 결정 근거 보여줘” → “활동 기록만” | 같은 decision 유지 → Activity projection만 반환 |
| 13 | “최근 회의 요약해줘” → “후속 작업만 다시” | 같은 report 유지 → action item section만 반환 |
| 14 | “지금 회의 몇 분째고 녹음 중이야?” | active Meeting → duration + recording 상태 조회 |
| 15 | “녹음 끝내고 회의록 만들어줘. 생성 요청됐는지도 알려줘” | recording 종료 confirmation → report job 결과 안내 |
| 16 | “첫 번째 작업 담당 바꾸고 두 번째는 반려해줘” | 두 mutation 대상을 분리한 confirmation plan |
| 17 | “회의방 중 진행 중인 것만 보고 첫 번째로 들어가줘” | 방 목록 → bounded ordinal → join confirmation |
| 18 | “오늘 EJ 회의 참석자 중 내 후속 작업 담당자도 있어?” | Meeting/participants + report/action item 교차 조회, 근거 없는 추측 금지 |
| 19 | “최근 재시도한 회의록의 결정이 실제 활동과 맞는지 봐줘” | retry report 해소 → decision evidence 조회 |
| 20 | “2번 말고 마지막 작업을 김세인에게 넘겨줘” | 이전 ordinal 취소 → 마지막 item + member 해소 → update confirmation |

### 인접 의도 오인식 방지

넓은 인식 범위가 잘못된 write로 이어지지 않도록 다음 반례를 별도 fixture로 둔다.

| 입력 | 인식하면 안 되는 동작 | 기대 처리 |
| --- | --- | --- |
| “EJ 회의 시작됐어?” | 회의 시작 | 현재 상태 조회 |
| “Backend 회의 들어갈 수 있어?” | 즉시 참여 | 가능 여부·현재 상태 안내, 명시적 참여 의도 없으면 실행하지 않음 |
| “나가면 회의 끝나?” | 즉시 나가기 | 마지막 참여자 영향 조회·설명 |
| “녹음 끝났어?” | 녹음 종료 | recording 상태 조회 |
| “이 작업 승인됐어?” | 승인 실행 | 후속작업 상태 조회 |
| “반려된 작업 보여줘” | 작업 반려 | `DISMISSED` 상태 검색 |
| “어제 말고 오늘 회의록” | 어제 report 조회 | 이전 날짜 조건을 오늘로 교체 |
| “회의는 안 들어가고 참여자만 볼게” | 회의 참여 | 참여자 조회만 수행 |

### 자연어 인식 품질 기준

- 각 capability는 canonical·수동 회귀 발화 전부, 서로 다른 변형 축을 조합한 positive 발화 12개
  이상, 직전 문맥 후속 발화 3개 이상, 인접 intent 반례 4개 이상을 eval에 포함한다.
- 의도 분류 뒤 필요한 entity와 시간 범위를 해소하고, 그다음 tool을 선택한다. entity가 없다는 이유로
  지원 의도 자체를 `unsupported`로 바꾸지 않는다.
- “보여줘”, “알려줘”, “뭐야”, “있을까”, “왜”, “근거가 뭐야”의 발화 종결 차이를 같은 조회
  capability 안에서 처리한다.
- “최근”, “가장 최근”, “오늘”, “어제”, “현재”, “진행 중”, “재시도”, “실패했던”의 시간·상태
  의미를 Workspace timezone과 실제 report/Meeting 상태에 연결한다.
- 조회, 제어, mutation, 근거 질문을 구분한다. 조회 발화를 write로 승격하지 않고, write 발화를 단순
  안내로 끝내지 않는다.
- 근거가 없으면 없는 사실을 명시한다. 다른 decision이나 다른 회의의 evidence를 그럴듯하게 붙이지
  않는다.
- canonical·수동 회귀 fixture는 전부 통과해야 한다. 별도로 고정한 held-out paraphrase set의 intent
  정확도는 95% 이상, write false positive는 0건, 지원 intent의 잘못된 `unsupported`는 0건을 목표로
  한다.

## 6. 자연어 Resource Selector

Planner는 raw ID 대신 다음 selector를 구성한다.

| Selector | 필드 | 예시 |
| --- | --- | --- |
| Meeting room | `name`, `hasActiveMeeting` | “Backend 회의방”, “EJ에서 진행 중인 방” |
| Meeting | `scope`, `roomName`, `from`, `to`, `status` | “현재 회의”, “오늘 EJ 회의” |
| Meeting report | `status`, `from`, `to`, `roomName`, `query`, `sort` | “어제 실패한 회의록”, “최근 재시도한 회의록” |
| Action item | `reportSelector`, `assignee`, `status`, `query`, `ordinal` | “내 미승인 후속 작업”, “이 회의의 2번” |
| Member | `self`, `displayName` | “나”, “김세인” |

### 해소 우선순위

1. 같은 run에서 사용자가 고른 `selectionToken`
2. 직전 동일 resource 목록의 검증된 `resourceRefs`와 순번
3. “현재”, “내가 참여한”에 대응하는 현재 사용자의 active Meeting
4. Workspace 안에서 정확히 일치하는 회의방·구성원 표시 이름
5. Workspace timezone으로 정규화한 상대 날짜, 상태, 제목 조건

### 해소 결과

- **1건:** 내부 ID를 다음 tool에 전달하고 원래 요청을 계속한다.
- **0건:** “오늘 EJ에서 열린 회의를 찾지 못했어요”처럼 적용한 조건을 알려준다.
- **2건 이상:** 최대 3건의 이름·일시·상태를 보여주고 선택받는다. 선택 후 새 요청을 만들지 않고 기존
  run의 원래 작업을 재개한다.

`selectionToken`은 실제 UUID를 복원할 수 없는 불투명 값이어야 하며 사용자, Workspace, run,
resource type, 만료 시간을 검증한다. 새 DB table은 만들지 않고 기존 run step의 resource reference나
서버 서명 token으로 먼저 구현한다.

## 7. 필수 Multi-tool 흐름

| 사용자 요청 | 기대 tool 흐름 |
| --- | --- |
| “Backend 회의방에서 회의 시작해줘” | `list_meeting_rooms` → 방 이름 해소 → `start_meeting_in_room` |
| “EJ에서 진행되는 회의에 들어가줘” | `list_meeting_rooms` → EJ current Meeting 해소 → `join_meeting` |
| “현재 회의에서 나가줘” | `get_active_meeting` → `leave_meeting` |
| “지금 회의 몇 분째야?” | `get_active_meeting` → `durationSec` 응답 |
| “오늘 EJ 회의에 누가 참여했어?” | 회의방·오늘 기간으로 Meeting 해소 → `get_meeting_participants` |
| “녹음 끝내고 회의록 만들어줘” | `get_active_meeting` → `end_meeting_recording` |
| “가장 최근에 실패한 회의록은 왜 실패했어?” | 실패 report 목록 → 최신 한 건 → `get_meeting_report` |
| “어제 회의 결정사항과 후속 작업만 알려줘” | 어제 report 목록 → 단일 선택 또는 후보 질문 → `summarize_meeting_report` |
| “후속 일정이 나오게 된 근거가 뭐야?” | 직전 report/action item 참조 → transcript·Activity evidence 조회 |
| “내가 맡은 회의 후속 작업이 뭐야?” | `me` 해소 → Workspace 범위 action item 검색 |
| “김진호가 맡은 후속 작업이 있을까?” | 구성원 이름 해소 → 담당자 기준 action item 검색 |
| “이 회의의 2번 작업을 김세인에게 넘기고 승인해줘” | 직전 2번 + 구성원 해소 → update → delivery 정보 수집 → confirmation → approve |
| “어제 디자인 회의 결정사항을 API v2로 바꿔줘” | `search_meeting_reports` → 단일 report 해소 또는 후보 선택 → 변경 preview → confirmation → `update_meeting_report_content` |

## 8. 구현 작업

### Phase 0. DB-independent Tool Discovery Foundation — 선행

> 진행 이슈: [#1398 — Phase 0 Tool Discovery foundation](https://github.com/Developer-EJ/PILO/issues/1398)
> 완료 이슈: [#1399 — Phase 0B compact catalog·shortlist shadow](https://github.com/Developer-EJ/PILO/issues/1399)
>
> 목적: DB migration이 진행 중인 기간에도 Agent 전반의 자연어 이해와 tool 선택 품질을 개선한다.
> 실제 resource 해소, candidate 소비, confirmation 실행, 공개 API·DB schema는 바꾸지 않는다.
> Phase 0 결과는 최종 운영 baseline이 아니라 `provisional` baseline으로 표시하며,
> DB 통합 검증은 Phase 1B와 Phase 3 E2E에서 완료한다.

#### 현재 통합 상태 — 2026-07-18 재검증

- [x] **0A / #1401 / #1398** — App Server-owned capability catalog, capability↔tool 다대다와
  chain, selector schema digest, runtime fail-closed validator, Phase 0 계약 문서는 `dev`에 병합됐고
  #1398은 닫혔다.
- [x] **0B / #1409 / #1399** — compact catalog SQS 전달, Worker schema digest binding,
  legacy/shadow evaluator를 최신 `dev`에 rebase해 병합했다. App Server·AI Worker CI는 모두 통과했고,
  #1399를 완료로 닫았다.

**Phase 전환 gate:** #1409 병합은 Phase 0B의 통합 회복일 뿐, Phase 0 전체 완료가 아니다. 아래
`0-1`부터 `0-6`의 inventory, 전 도메인 fixture, 실행 shortlist/fallback 검증, shadow 지표·privacy-safe
관측, 자동화된 quality gate가 완료되기 전에는 **Phase 1B, Phase 2 이후 실행 E2E 확대, Phase 4의
model/retrieval rollout**으로 전환하지 않는다. DB 비의존적인 Phase 1A fixture·평가 보강은 provisional
작업으로 병렬 진행할 수 있으나, model 교체나 production 판단 근거로 사용하지 않는다.

#### 0-1. 전체 Tool inventory와 잠정 baseline

- [x] `AgentToolRegistryService`의 등록 tool을 자동 추출해 domain, action, read/write, risk,
  execution mode, 필수 request surface/context와 현재 schema 크기를 inventory SHA로 고정한다.
- [x] 현재 all-eligible schema를 planner에 제공하는 흐름을 `legacy` baseline으로 기록하고,
  tool 수·schema byte/token 추정치·fixture의 기대 tool 선택 분포를 동일 catalog/suite SHA와 함께 출력한다.
- [x] registry에는 있으나 capability 또는 legacy eval fixture가 없는 tool을 CI가 누락 목록으로 출력한다.

현재 baseline: 전체 registry 36개 중 legacy planner fixture는 34개를 포함한다. context 전용
`delegate_canvas_agent`, `recommend_pr_review_focus`는 누락 목록으로 고정됐으며, 다음 `0-3`에서
도메인별 fixture를 추가해 해소한다. 실제 provider planner의 결과 baseline은 Phase 1B의 dev 실행으로
별도 기록한다.

#### 0-2. 공통 capability catalog와 Tool descriptor 계약

- [x] capability와 tool을 분리하고 다대다 매핑을 지원한다. capability는 사용자 목표와 기대 tool
  sequence를, Tool descriptor는 실행 가능한 tool의 사용 경계를 나타낸다.
- [x] descriptor에 `toolName`, `domain`, `action`, `capabilityIds`, `whenToUse`, `mustNotUseFor`,
  prerequisite/follow-up tool, accepted selector, risk/confirmation을 둔다.
- [x] catalog schema를 runtime validator로 검증하고 catalog version·SHA를 eval/shadow 결과에 남긴다.
  full input schema의 canonical digest를 포함해 type/format/enum/required/nested selector 변경도 SHA에
  반영한다.
- [x] registry↔catalog 사이의 누락, duplicate capability ID·chain tool, 존재하지 않는 tool 참조를
  runtime/test에서 fail-closed로 처리한다.

#### 0-3. 도메인별 compact catalog와 offline fixture

- [x] 기존 Meeting catalog를 공통 descriptor 형식으로 변환한다.
- [x] Calendar, Board, Canvas, SQLtoERD, Drive, PR Review의 현재 등록 tool도 최소 descriptor와
  대표 capability를 등록한다. API/DB가 아직 없는 capability는 `unsupported` 경계로 분리한다.
- [x] 각 descriptor에 positive 표현, 오타·존댓말·축약 변형, `mustNotUseFor` 인접 intent 반례,
  필요한 selector 종류와 confirmation 여부를 기록한다.
- [x] DB row나 UUID가 필요한 selector value는 평가하지 않고, 기대 domain/action/capability,
  selector 종류, 필수 tool sequence만 평가한다.

#### 0-4. DB 비의존 Tool retrieval과 shortlist

- [x] App Server가 계산한 기존 hard eligibility를 입력으로 사용하되, AI Worker router에는 full JSON
  schema가 아니라 compact catalog만 전달한다. runtime은 catalog의 canonical schema digest를 검증한 뒤
  prompt와 compact descriptor로만 retrieval한다.
- [x] 최초 retriever는 deterministic domain/action metadata filter와 교체 가능한 semantic rerank
  adapter를 결합한다. 기본 shortlist는 `topK = 8`, schema budget은 8,000 token이며 capability의
  topK 안에서 예산에 들어온 capability들의 prerequisite/follow-up chain만 추가한다. primary chain이
  예산을 넘으면 legacy로 fallback하고, 낮은 순위 chain은 건너뛴다.
- [x] `AGENT_TOOL_RETRIEVAL_MODE=read_only_shortlist`에서 planner에는 최종 read-only shortlist schema만
  전달한다. shortlist 밖 tool 출력은 planning failure로 거부하고, 낮은 confidence·budget 초과·retriever
  예외·write capability는 legacy all-eligible planner로 fallback한다. offline shadow evaluator도 같은
  selection helper로 이 fallback을 재현한다. 기본 mode는 `shadow`다.
- [x] low-confidence가 mutation을 단독으로 선택하거나 지원 요청을 즉시 `unsupported`로 바꾸지
  않도록 한다. App Server registry, validator, Workspace 권한, confirmation, revalidation은
  여전히 권위 있는 실행 경계다.

#### 0-5. 평가·shadow·privacy-safe 관측

- [ ] canonical/held-out fixture에서 domain/capability recall@k, 필수 tool recall@k, 인접 intent
  오선택, supported→unsupported 오판, shortlist 크기, latency를 계산한다.
- [ ] `(legacy all-tool + current planner)`와 `(retriever shortlist + current planner)`를 같은
  catalog/suite/model/date/timezone/seed에서 비교한다. candidate model 비교는 Phase 4에서 추가한다.
- [ ] feature flag로 legacy와 shortlist 경로를 전환 가능하게 하고, 초기에는 DB 실행 결과에 영향을
  주지 않는 offline 또는 shadow mode만 사용한다.
- [ ] catalog/model/retriever version, 후보 수, confidence 구간, fallback 이유, latency/token usage만
  bounded event로 남긴다. raw 사용자 발화, UUID, resource reference, tool payload, token, secret은
  관측 데이터에 저장하지 않는다.

#### 0-6. Phase 0 검증과 완료 기준

- [ ] catalog schema·registry 정합성·canonical/held-out retrieval·인접 intent negative·shortlist
  token budget·fallback·low-confidence mutation safety·UUID/token 비노출 회귀를 자동화한다.
- [ ] canonical fixture에서 필수 tool recall@8 100%, held-out fixture에서 domain/capability
  recall@8 95% 이상을 초기 목표로 기록한다. 미달 시 threshold를 숨기지 않고 failure taxonomy와
  함께 남긴다.
- [ ] catalog, suite, eligible snapshot, shortlist, model, retriever version/SHA가 결과마다 재현
  가능하게 남는다.

완료 기준: 모든 현재 등록 tool이 inventory와 descriptor에서 추적되고, DB 없이 재현 가능한
retrieval baseline과 fallback/shadow 경로가 준비된다. 이 Phase만으로 resource selector 실행,
candidate 선택 뒤 재개, write confirmation E2E 또는 production rollout을 완료 처리하지 않는다.

#### 다음 실행 순서 — Phase 0 잔여

1. [ ] **0-1 inventory와 legacy baseline을 자동화한다.** registry에서 현재 등록 tool을 추출해
   inventory artifact로 고정하고, catalog 또는 eval fixture가 없는 tool을 CI에서 누락 목록으로
   실패시킨다. 같은 artifact에 legacy full-tool schema 크기·token 추정치·routing 결과를 기록한다.
2. [x] **0-3 전 도메인 descriptor/fixture를 완결한다.** Meeting, Calendar, Board, Canvas, SQLtoERD,
   Drive, PR Review의 descriptor가 positive·변형·인접 intent negative·selector/confirmation 경계를
   모두 갖는지 확인한다. API/DB 미지원 capability는 명시적 `unsupported`로 분리한다.
3. [ ] **0-4~0-6 quality gate를 실행 가능하게 만든다.** deterministic retrieval, topK/chain/token
   budget, low-confidence fallback, shortlist 밖 tool 거부를 legacy와 비교하고, canonical/held-out
   recall@8·latency·fallback/privacy-safe telemetry를 CI와 release baseline에서 재현한다.

완료된 PR 분할: [#1398](https://github.com/Developer-EJ/PILO/issues/1398) `Phase 0A`
(capability catalog) → [#1399](https://github.com/Developer-EJ/PILO/issues/1399) `Phase 0B`
(retriever·shortlist handoff·shadow) 순서였다. `0-1`, `0-3`~`0-6`은 Phase 0 전체 완료를 위한
후속 작업으로 별도 추적한다.

#### Phase 0 구현 전 결정 필요

- [x] **descriptor의 권위 source** — App Server가 versioned descriptor를 소유하고, outbox가
  Worker/evaluator에 immutable snapshot을 전달한다. Worker JSON을 독자 source로 두지 않는다.
- [x] **초기 domain 등록 범위** — 현재 registry의 모든 domain에 최소 descriptor는 등록하되,
  shortlist 실행은 read-only capability부터 shadow mode로 시작한다. mutation은 Phase 0에서 실행하지 않는다.
- [x] **retrieval 방식** — v1은 deterministic metadata filter + semantic rerank adapter로 시작한다.
  semantic provider/embedding 모델은 adapter 뒤에 두고, offline 결과를 보기 전에는 고정하지 않는다.
- [x] **baseline 비용·실행 주기** — CI에서는 fixture·deterministic routing만 검사하고, provider를
  쓰는 baseline/shadow는 승인된 dev 환경에서 release 후보마다 3회 반복한다. model·월 비용 상한·실행
  권한을 확정해야 한다.
- [x] **Phase 0 PR 경계** — `0A`와 `0B`를 별도 Issue/PR로 나눈다. #1398은 0A, #1399는 0B로
  관리하며 0A 완료 뒤 0B를 시작한다.

### Phase 1. Regression 기준 고정

> 진행 이슈: [#1371 — Meeting Agent 회귀 fixture와 held-out 평가셋](https://github.com/Developer-EJ/PILO/issues/1371)
>
> DB migration 의존 경계: fixture/catalog/UUID 비노출과 Phase 0 retrieval 평가는 지금 진행한다.
> 실제 OpenAI dev baseline, resolver의 cross-workspace 실행, stateful planner/App Server 통합 평가는
> DB migration이 안정화된 뒤 **Phase 1B**로 완료한다. 그 전 결과는 `provisional`로만 사용하며
> model 교체 또는 production rollout 판단 근거로 사용하지 않는다.

- [x] 현재 등록된 Meeting tool 18개의 capability를 catalog로 만들고 AI Worker planner eval fixture로
  옮긴다. 전체 수동 검증 발화와 App Server 실행 fixture 전환은 후속으로 남긴다.
- [x] 이미 성공한 발화와 실패한 발화를 모두 포함해 개선 전 baseline을 기록한다. #721에서 고정
  30개 한국어 발화를 실제 dev Chatbot으로 실행하고 UI·DB run/step·AWS readback을 대조해 정확 26건,
  부분 정확 2건, 오인식 2건을 기록했다.
- [x] capability마다 positive 12개 이상, 문맥 후속 발화 3개 이상, 인접 intent 반례 4개 이상을
  공통 발화 변형 축에서 조합한다.
- [x] 같은 의미를 새 어휘와 어순으로 표현한 held-out paraphrase set을 학습·prompt 예시와 분리해
  관리한다.
- [x] planner의 사용자 노출 `message`와 `finalAnswerDraft`에서 UUID 패턴이 0건인지 검사한다. 한글
  인접 UUID와 1000자 길이 경계도 회귀로 고정한다.
- [x] capability contract에 기대 intent, selector, tool 순서, 요청 section, 현재/목표 최종 상태를 기록한다.
- [x] 0건, 단일 결과, 복수 결과, 동명이인 구조 fixture를 각각 만든다.
- [ ] context follow-up·인접 intent 반례를 실제 planner 상태/실행 eval로 검증한다.
- [ ] 0/1/N·동명이인·다른 Workspace resource 거부를 App Server resolver 실행 fixture로 검증한다.
- [ ] 고정한 기준일·모델로 OpenAI dev baseline을 실행하고 결과 JSON·오인식 분류를 #1371에 기록한다.

완료 기준: 모든 제목의 현재 성공·실패가 baseline에 재현되고 이후 단계가 동일 fixture를 통과시킨다.

현재 상태: #721의 최초 baseline(49 case)은 유지한다. #1371 / PR #1374에서 18개 등록 Meeting tool의
canonical 216개(각 12개)·held-out 54개 발화, capability별 context follow-up 3개·counterexample 4개,
0/1/N·동명이인 구조 fixture, 요청 section, UUID 비노출 회귀, suite/catalog SHA-256 기록을 추가했다.
AI Worker 로컬 전체 검증은 `black --check app tests`, `ruff check app tests`, `python3.13 -m pytest`
(230 passed), `python3.13 -m compileall app`까지 통과했다. 다만 실제 OpenAI dev baseline, stateful
context/counterexample 평가, resolver의 cross-workspace 실행 검증은 아직 없으므로 Phase 1을 전체 완료로
표시하지 않는다.

#### Phase 1 세부 구현 계획 — #1371

1. [x] **Capability catalog를 고정한다.** `MeetingAgentToolMatrix.md`의 현재 지원 Meeting capability를
   stable capability ID로 옮기고, 각 항목에 canonical 발화, 현재 planner 기대 상태·tool·입력,
   이후 selector 구현 뒤의 목표 tool 흐름, 인접 intent 반례를 기록한다. 아직 API/Tool이 없는
   capability는 지원 항목처럼 측정하지 않고 명시적 `unsupported` 경계로 분리한다.
2. [x] **Canonical과 held-out을 분리한다.** canonical suite는 planner prompt·회귀의 기준으로 사용하고,
   held-out suite는 같은 capability를 새 어휘·어순·존댓말로 바꾼 발화만 둔다. 두 suite는 case ID,
   prompt, seed 예시를 공유하지 않으며 같은 tool snapshot을 참조한다.
3. [x] **평가 계약을 넓힌다.** case마다 `capability`, `kind`(positive/context/counterexample), 기대
   intent, selector, tool sequence, 최종 상태를 보관한다. 현재 single-turn planner evaluator가
   실행 가능한 값은 status/tool/input/confirmation으로 비교하고, selector·다중 tool 흐름은
   catalog contract로 먼저 검증한다.
4. [x] **최소 coverage를 test로 강제한다.** 지원 capability별 positive 12개 이상, context 3개 이상,
   인접 intent 반례 4개 이상과 0/1/N·동명이인 case 존재를 구조 검증 test로 고정한다. 누락은
   baseline 실행 전에 실패시킨다.
5. [x] **UUID 비노출 회귀를 추가한다.** 사용자 노출 planner `message`·`finalAnswerDraft`에서 유효
   UUID를 내부 식별자로 치환하고 1000자 경계까지 검사한다. 내부 tool input과 server-only resource
   reference는 검사 대상에서 제외한다. 상태별 UI/confirmation E2E는 후속으로 남긴다.
6. [ ] **실행 재현성을 완결한다.** fixed current date, `Asia/Seoul`, model, repetitions, suite SHA,
   Meeting catalog SHA와 source revision을 결과에 남긴다. 실제 OpenAI dev baseline은 자격 증명이 있는
   환경에서 실행하고 결과 JSON과 오인식 분류를 #1371에 첨부한다.

구현 순서: catalog/schema·구조 검증 → canonical fixture → held-out fixture → UUID 회귀 → local
unit/script 검증까지 완료했다. 다음으로 stateful planner/App Server resolver 실행 fixture와 dev planner
baseline을 같은 기준일·모델로 실행해 #1371에 기록한다.

### Phase 2. App Server Resource Resolver

> 진행 이슈: [#1375 — Meeting Agent Resource Resolver](https://github.com/Developer-EJ/PILO/issues/1375)
>
> 범위 경계: 이 Phase는 App Server 내부의 해소·재검증 경계와 후보 계약을 만든다. 선택 token은
> `SESSION_SECRET`에서 파생한 키로 AES-GCM 암호화와 HMAC 서명을 함께 적용하고, 사용자·Workspace·run·
> resource type·15분 만료를 묶는다. planner-facing
> tool schema에서 UUID 대신 selector를 받게 하는 변경은 Phase 3, 자연어 날짜·상태·대명사 해석은
> Phase 4에서 수행한다. 따라서 Resolver 입력은 이미 정규화된 selector만 받으며 공개 API·DB schema는
> 변경하지 않는다.

- [x] Meeting Agent tool adapter 안에 `MeetingAgentResourceResolver` 경계를 추가한다.
- [x] Meeting room 이름, 현재 active Meeting, 기간별 Meeting, 기간·상태별 MeetingReport를 해소한다.
- [x] 현재 사용자와 구성원 표시 이름을 Workspace member ID로 해소한다.
- [x] action item을 report, 담당자, 상태, 제목, 직전 목록 순번으로 해소한다.
- [x] 선택 token을 소비하기 직전에 기존 domain service로 재조회해 권한과 최신 상태를 검증한다.
- [x] 0건·복수 결과를 구조화한 후보 결과로 반환하고 raw UUID는 formatter에서 제거한다.

완료 기준: resolver 단위 테스트에서 단일·없음·복수·다른 Workspace resource 거부가 통과한다.

#### Phase 2 세부 구현 계획 — #1375

- [x] **1. Resolver 계약과 안전한 결과 타입을 고정한다.** `MeetingAgentResourceResolver`의 입력을
  정규화된 room name, current/기간 Meeting, 기간·상태 MeetingReport, member name/self, action item
  report·담당자·상태·제목·순번 selector로 정의한다. 결과는 `selected` 또는
  `needs_clarification`만 허용하고, 후보에는 이름·시각·상태·title처럼 사람이 읽을 수 있는 정보만
  둔다. 내부 UUID는 resolver 반환값과 formatter에 포함하지 않는다.
- [x] **2. Workspace 범위 read model을 만든다.** 기존 `MeetingService`와 `WorkspaceService`의
  권한 검사를 재사용해 회의방·현재 active Meeting·Meeting·MeetingReport·Workspace member를 조회한다.
  action item은 report·담당자·상태·제목 조건을 Workspace 범위에서 교차 조회하되, 모든 SQL에
  Workspace 조건을 둔다. 자연어 날짜·상태 파싱과 fuzzy matching은 넣지 않는다.
- [x] **3. 단일/0/N 해소 정책을 구현한다.** exact case/공백 정규화로 후보를 찾고, 단일 결과만
  `selected`로 반환한다. 0건은 적용 조건을 설명하는 `not_found`, 복수는 최대 3개의 안전한 후보와
  전체 건수를 담은 `ambiguous` clarification으로 반환한다. 정렬은 최신 Meeting/Report, 안정적인
  action item 순번으로 고정한다.
- [x] **4. 현재 사용자·동명이인·다른 Workspace를 차단한다.** `self`는 인증된 요청 사용자로만
  해소하고, 표시 이름은 같은 Workspace member 중 정확히 한 명일 때만 선택한다. active Meeting이
  다른 Workspace에 있거나 외부 UUID가 주입돼도 존재 여부를 노출하지 않고 현재 Workspace의
  `not_found`/clarification으로 끝낸다.
- [x] **5. 실행 직전 재검증 경계를 만든다.** Resolver가 선택한 내부 reference는 tool 실행 전에
  `MeetingService`의 Workspace-scoped 상세 조회로 다시 읽는다. MeetingReport/action item은
  report와 item의 소속·현재 상태를 함께 재확인하고, 변경/삭제/권한 상실 시 기존 도메인 오류 또는
  clarification으로 처리한다. 이 단계는 selector를 planner schema에 노출하지 않는다.
- [x] **6. Agent tool adapter 연결 지점을 준비한다.** 현재 UUID 전용 tool은 기존 계약을 유지한다.
  Phase 3에서 selector schema를 붙일 수 있도록 resolver 호출·candidate formatter·revalidation
  helper를 도메인 내부에 두고, 공개 endpoint와 tool registry의 기존 입력은 변경하지 않는다.
- [x] **7. 회귀 테스트를 추가한다.** 회의방 이름, 현재 Meeting, 기간/상태별 Report, self/member,
  action item의 단일·0·복수·동명이인 시나리오를 추가한다. 다른 Workspace Meeting/Report/action item과
  raw UUID가 후보·clarification에 나타나지 않는지, 실행 직전 재검증이 stale 대상 실행을 막는지도
  script test로 검증한다.
- [x] **8. 문서·검증을 마무리한다.** `MeetingAgentToolImprovementPlan.md`와 #1375 체크리스트를
  구현 결과로 갱신하고, App Server format/lint/build 및 Agent resolver script test 결과를 PR에
  기록한다. 공개 API·DB schema 변경이 없음을 재확인한다.

구현 순서: contract/test fixture → Workspace-scoped read model → 0/1/N formatter → revalidation
helper → adapter preparation → cross-workspace regression 순서로 진행한다.

현재 상태: `MeetingAgentResourceResolver`와 Workspace-scoped Meeting/Action item read model 구현을
완료했다. 후보와 clarification은 사람이 읽을 수 있는 값만 반환하며, selection token은 UUID를 평문으로
담지 않는다. `npm run build`, `node scripts/agent/meeting-tools.test.mjs`, `npm run format:check`,
`npm run lint`을 통과했다. planner-facing selector schema와 실제 tool input의 token 소비 연결은 계획된
Phase 3 작업으로 남긴다.

### Phase 3. Tool Schema 확장

> 진행 이슈: [#1382 — Meeting Agent Phase 3 selector와 token 실행 연결](https://github.com/Developer-EJ/PILO/issues/1382)
> 하위 구현: [#1385 후보 선택 foundation](https://github.com/Developer-EJ/PILO/issues/1385) →
> [#1386 read/control·report selector](https://github.com/Developer-EJ/PILO/issues/1386) →
> [#1387 action item selector·mutation](https://github.com/Developer-EJ/PILO/issues/1387)
>
> 범위 경계: Phase 2 Resolver가 만든 opaque selection token을 실제 planner-facing tool input과
> App Server 실행 경계에서 소비한다. token의 plaintext와 raw UUID는 Agent run/step/log, SQS,
> provider prompt, 사용자 응답에 저장·노출하지 않는다. 후보 선택 뒤 token을 어떤 server-owned
> 경로로 전달할지는 구현 전 제품·API/DB 계약으로 확정한다.

- [ ] 회의 제어 tool이 `current`, `roomName`, 검증된 `selectionToken`을 planner-facing 입력으로 받게 한다.
- [ ] `list_meeting_reports`에 `from`, `to`, `roomName` 또는 service가 지원하는 검색 조건을 추가한다.
- [ ] `find_action_items`가 `reportId` 없이도 Workspace 범위에서 담당자·상태·기간으로 검색되게 한다.
- [ ] 후속작업 mutation이 action item selector와 member selector를 받아 실행 직전에 내부 ID로 바꾸게 한다.
- [ ] 기존 UUID 입력은 내부 호환 경로로만 유지하고 planner schema의 기본 경로에서는 제거한다.

공개 Meeting API endpoint를 추가하기 전에 `MeetingService`의 기존 query를 tool adapter에서 재사용할 수
있는지 먼저 확인한다. API endpoint, request, response가 바뀌면 `docs/api/meeting-api.md`와
`docs/api/agent-api.md`를 같은 변경에서 갱신한다.

완료 기준: 사용자 문장에 UUID가 없어도 각 tool이 구조화된 selector로 실행된다.

#### Phase 3 세부 구현 계획 — #1382

- [ ] **1. 현재 UUID 경로와 migration 순서를 고정한다.** Meeting tool별 planner schema, `validateInput`,
  `prepareExecution`/`execute`, domain service 호출의 UUID 필드를 표로 만들고 read/control → report/action
  item search → write mutation 순으로 분리한다. 새 public endpoint·DB schema가 필요한지 이 단계에서 확정한다.
- [ ] **2. selector schema를 명시한다.** room/current meeting/meeting/report/member/action item selector의
  허용 필드, ISO datetime 범위, 상태 enum, 정렬, 1-based ordinal을 runtime validator와 Agent tool schema에
  같은 계약으로 추가한다. UUID를 planner 기본 schema에서 제거한다.
- [ ] **3. token 소비 경계를 만든다.** selection token은 App Server에서만 검증·복호화하고
  user/workspace/run/resource type/15분 만료와 stale resource를 다시 확인한다. token plaintext·raw UUID는
  Agent 저장소, SQS, provider prompt, 사용자 응답으로 보내지 않는다.
- [ ] **4. ambiguity 선택 전달 방식을 확정·구현한다.** 후보 선택을 browser가 단순 token echo로 처리하지
  않으며, 0/N 후보·동명이인·만료 후보·다른 Workspace/run 선택은 기존 tool을 실행하지 않고 clarification으로
  끝낸다. 필요한 API/DB/Frontend 계약은 이 항목과 같은 PR에서 문서화한다.
- [ ] **5. read/control tool adapter를 연결한다.** Meeting room/현재 Meeting/Meeting control과
  report 조회 tool이 selector → resolver → revalidated internal reference → 기존 domain service 경로를
  사용하도록 만든다.
- [ ] **6. report/action item 조회를 확장한다.** `list_meeting_reports`, `find_action_items`가
  Workspace-scoped selector를 받고, 직전 목록 순번은 같은 필터·정렬의 1-based 위치에서만 해소한다.
- [ ] **7. action item write를 연결한다.** action item/member selector를 confirmation 전과 승인 직전에
  모두 재검증하며, 실패·모호·만료 상황은 write 후보/confirmation을 만들지 않는다.
- [ ] **8. planner·formatter·UI 경계를 맞춘다.** AI Worker structured planner contract와 App Server tool
  snapshot을 동기화하고, formatter/Frontend는 사람이 읽을 수 있는 후보와 질문만 표시한다.
- [ ] **9. 보안·회귀·E2E를 고정한다.** 0/1/N·동명이인·cross-workspace, token binding/만료/변조/stale,
  UUID/token 비노출, confirmation write 재검증을 App Server·AI Worker·Frontend에서 검증한다.
- [ ] **10. 배포 전 검증을 수행한다.** build/lint/format/Agent script/AI Worker pytest와 dev에서
  자연어 요청 → clarification 선택 → tool 실행 또는 confirmation 흐름을 같은 runId로 대조한다.

#### Phase 3 확정 제품·보안 결정

- [x] 후보 선택은 자유 텍스트의 “1번/2번” 해석이 아니라 Agent 채팅의 **후보 버튼**으로 한다.
- [x] browser는 사람이 읽지 않는 opaque `candidateSelectionId`만 제출한다. 실제 resource reference와
  selection token은 서버가 저장·검증하며 token plaintext는 browser, Agent 저장소, SQS, provider prompt에
  남기지 않는다.
- [x] candidate selection은 user·Workspace·run에 묶고 TTL은 **15분**으로 통일한다. 만료·중복 소비·다른
  user/Workspace/run 선택은 실행하지 않고 후보 재조회 clarification으로 처리한다.
- [x] 동명이인 후보는 표시 이름·role·부분 마스킹 email을 함께 표시한다. 이메일 전체와 raw UUID는
  사용자 메시지에 노출하지 않는다.
- [x] UUID 기반 경로는 user/planner-facing schema에서 제거한다. 기존 domain service의 UUID 입력은
  App Server 내부 compatibility boundary로만 분리한다.
- [x] Phase 3 구현은 #1385 → #1386 → #1387의 **세 PR**로 나눈다. #1385의 durable candidate record는
  DB schema/API/Frontend 변경 가능성이 있으므로 DB Schema owner와 관련 계약을 먼저 확인한다.

### Phase 4. Cross-domain Tool Discovery와 Planning Intelligence

> 첫 적용 이슈: [#1393 — Meeting Agent selector 기반 multi-turn planning](https://github.com/Developer-EJ/PILO/issues/1393)
>
> 방향: #1393은 Meeting을 첫 vertical·회귀 기준으로 사용한다. Phase 4의 공통 산출물은 Meeting 전용
> prompt가 아니라 Calendar·Board·Canvas·SQLtoERD·Drive·PR Review가 등록해 재사용할 수 있는 Tool 검색,
> 구조화 intent/selector, context resume, evaluator·관측 계약이다. 각 도메인의 App Server validator,
> Workspace 권한, confirmation, 실행 직전 재검증은 그대로 권위 있는 보안 경계로 유지한다.
>
> 선행 조건: Phase 3의 server-owned candidate selection과 #1355의 bounded thread memory를 사용한다.
> Phase 3이 `dev`에 반영되기 전에도 catalog·retriever·offline eval을 만들 수 있지만, 실제 후보 선택 재개와
> write execution 평가는 Phase 3 병합 뒤 완료한다.

#### 현재 구조 기준 가능성 판단

- `AgentToolRegistryService`는 이미 Calendar·Meeting·Board·SQLtoERD·PR Review·Canvas·Drive tool을 한
  registry에서 관리하고 `requestContext` surface 기준 hard eligibility를 적용한다. 여기에 capability
  catalog와 shortlist API를 추가할 수 있다.
- `AgentOutboxPublisherService`는 현재 eligible tool의 전체 schema snapshot을 Worker job에 넣고,
  `agent_processor.py`는 그 전체 schema를 planner prompt에 포함한다. 따라서 registry/execution을 다시
  만들지 않고도 Worker 앞단에 router를 두어 provider에 전달되는 schema만 줄일 수 있다.
- App Server의 `getDefinitionForContext`, `validateInput`, risk/execution mode, confirmation과 실행 직전
  domain 재검증은 planner가 고른 shortlist와 독립적이다. Tool 검색과 model을 바꿔도 이 경계를 그대로
  유지할 수 있다.
- 기존 evaluator는 tool/status/input 일부를 비교하고 `--model`, `--repetitions`, input SHA 기록을 이미
  지원한다. 여기에 retrieval·tool sequence·multi-turn state·cost/latency metric을 확장하는 방식으로
  current/candidate model 비교를 구현할 수 있다.

결론: Phase 4를 Meeting prompt 개선에 한정할 기술적 이유는 없다. 공통 Tool 검색·intent/selector·
multi-turn·평가 계층을 먼저 만들고 Meeting을 첫 vertical로 검증하는 방향이 가능하며, 기존 App Server
보안 경계를 약화하지 않는다.

#### 목표 architecture

```text
사용자 발화 + safe thread context
  -> domain/action 후보 검색
  -> 구조화 intent + selector 초안
  -> 관련 tool schema shortlist
  -> planner의 tool sequence/clarification 결정
  -> App Server selector 해소·권한 확인·confirmation·실행 직전 재검증
```

모델에는 모든 tool schema를 무조건 한꺼번에 주지 않는다. Tool 검색 계층이 먼저 관련 domain과 action을
좁히고, planner는 선택된 schema만 사용한다. 검색 confidence가 낮으면 인접 domain bundle까지 bounded
확장하거나 사람이 이해할 수 있는 clarification을 만들며, mutation tool을 추측해서 실행하지 않는다.

- [ ] 사용자 목표를 stable capability catalog로 정의하고, 하나의 capability가 조건부 tool chain에,
  하나의 tool이 여러 capability에 매핑될 수 있는 다대다 계약을 만든다. Tool descriptor에는 domain,
  action, capability ID 목록, 사용 조건, 금지 인접 요청, selector, risk/confirmation을 둔다.
- [ ] 사용자 발화와 현재 surface·thread context로 domain/action 후보를 먼저 좁히고 관련 tool schema만
  planner에 주는 Tool 검색 계층을 추가한다.
- [ ] “어제 회의록”, “진호에게”, “두 번째 작업”, “그거”를 각각 `dateRange`, `memberSelector`,
  1-based `ordinal`, server-owned `contextRef`로 만드는 공통 intent/selector 계약을 정의한다.
- [ ] 후보 선택과 clarification 뒤 original goal을 보존해 같은 조회를 반복하지 않고 다음 tool 또는
  confirmation으로 재개한다.
- [ ] capability마다 표현 변형·오타·존댓말·축약·인접 intent 반례·single/multi-turn·후보 선택 재개를
  canonical/held-out suite로 고정한다.
- [ ] tool 미선택, 잘못된 routing, selector 실패, 반복 clarification을 raw 사용자 데이터 없이 안전한
  taxonomy로 관측하고 재현 가능한 eval case로 승격한다.
- [ ] 현재 planner model의 정확도·비용·지연시간 baseline을 만들고 candidate model을 같은 suite에서
  비교한다. 이득이 검증되면 planner model만 교체하며 App Server 검증 경계는 바꾸지 않는다.
- [ ] Meeting에서 먼저 end-to-end 기준을 통과한 뒤 Calendar, Board, Canvas·SQLtoERD, Drive·PR Review를
  같은 descriptor/selector/eval 계약으로 순차 등록한다.

완료 기준: Meeting을 포함한 등록 domain의 지원 요청이 높은 Tool 검색 recall로 관련 schema shortlist에
포함되고, 올바른 tool sequence·selector·clarification/confirmation으로 끝난다. raw UUID·token·내부
field가 사용자 또는 provider-visible context에 노출되지 않으며, 현재 model 대비 품질·비용·지연시간
비교 결과와 rollout 판단 근거가 재현 가능하게 남는다.

#### Phase 4 세부 구현 계획

- [ ] **1. 전체 Tool inventory와 현재 model baseline을 고정한다.** App Server registry의 모든 tool을
  domain·read/write·risk·execution mode·필수 context·현재 대표 발화에 매핑한다. 현행처럼 전체 schema를
  제공했을 때의 domain recall, tool top-1, selector exact match, clarification/confirmation 상태,
  supported→unsupported 비율, 토큰 비용과 p50/p95 지연시간을 동일 기준일·모델로 기록한다.
- [ ] **2. capability catalog와 Tool descriptor 계약을 분리한다.** capability는 사용자가 달성하려는
  목표와 기대 tool sequence를 나타내고, Tool descriptor는 `domain`, `action`, `capabilityIds`,
  `whenToUse`, `mustNotUseFor`, accepted selector, prerequisite/follow-up, risk/confirmation을 나타낸다.
  capability↔tool은 다대다로 매핑하며 positive/adjacent-negative example과 schema snapshot을 catalog
  version·SHA로 묶어 설명 문구와 eval fixture가 서로 다른 source of truth로 떠돌지 않게 한다.
- [ ] **3. 2단계 Tool 검색 계층을 구현한다.** App Server는 기존처럼 surface·context의 hard eligibility를
  먼저 적용한다. AI Worker router는 전체 JSON schema 대신 eligible tool의 compact capability catalog만
  보고 domain/action 후보를 고른 뒤 descriptor의 positive/negative evidence로 tool을 rerank한다. 최초
  구현은 deterministic metadata filter와 semantic score를 결합하며 결과는 bounded top-k와 필요한 chain
  tool만 포함한다.
- [ ] **4. planner handoff를 shortlist 기반으로 바꾼다.** v1 transport는 호환성을 위해 eligible schema
  snapshot 전체를 Worker에 전달할 수 있지만 router/provider에는 compact catalog만, planner/provider에는
  최종 shortlist schema만 제공한다. catalog·eligible snapshot·shortlist를 각각 version/SHA로 기록한다.
  shortlist 밖 tool name·field·UUID는 normalization에서 거부한다. retrieval 장애나 낮은 confidence에서는
  동일 App Server validation/confirmation을 사용하는 legacy all-eligible planner 또는 bounded domain 확대를
  사용해 supported write를 거짓 `unsupported`로 만들지 않는다. 후속 최적화에서 schema fetch 경계를
  추가해 SQS payload 자체도 줄인다.
- [ ] **5. 사용자 발화를 공통 intent/selector로 구조화한다.** 하나의 거대한 범용 selector를 만들지 않고
  공통 primitive와 domain adapter를 조합한다. domain별 자유 형식 UUID 입력이 아니라
  `dateRange`, `status`, `sort`, `limit`, `roomSelector`, `memberSelector`, `ordinal`, `contextRef` 등
  명시된 selector를 생성한다. Workspace timezone으로 상대 날짜를 정규화하고, App Server tool schema에
  없는 selector field는 planner가 출력하지 못하게 한다.
- [ ] **6. App Server resolver·selection adapter 경계를 일반화한다.** 현재 `/inputs`의 선택 처리가 특정
  SQLtoERD session 또는 Meeting service에 hard-code돼 있는 지점을 먼저 inventory하고, Phase 3의
  Meeting candidate/reference 흐름을 공통 `domain + resourceType + selector + candidateGeneration + revalidate`
  계약으로 추상화하되 기존 동작은 그대로 유지한다.
  Calendar event, Board/issue/member, Canvas selection, SQLtoERD session, Drive document, PR Review revision은
  도메인 adapter가 selector 해소와 현재 권한·상태 재검증을 담당한다. DB/API 변경이 필요하면 domain·DB
  owner 확인 뒤 별도 migration/contract PR로 분리한다.
- [ ] **7. bounded multi-turn context와 `contextRef`를 연결한다.** `get_active_meeting`, MeetingReport,
  Calendar list, Board search, Canvas/SQLtoERD selection 등 완료 tool의 safe projection만 최신성·정렬·byte
  제한과 함께 저장한다. raw tool JSON, transcript, Activity metadata, UUID, token, secret은 제외하고,
  대명사·순번은 같은 thread의 server-owned `contextRef`에서만 해소한다.
- [ ] **8. clarification 뒤 original goal을 재개한다.** server-owned state에는 original capability/goal,
  미해결 selector slot, 완료된 safe `contextRef`, candidate generation만 저장하고 다음 tool eligibility는
  재개 시 registry에서 다시 계산한다. 후보 버튼을 기본 UI로 유지하되
  “1번으로 해줘” 같은 자연어 ordinal은 같은 user·Workspace·run/thread의 **최신 eligible candidate
  generation**에만 1-based로 결합한다. 선택 뒤 original goal의 다음 단계로 진행하고 같은 list/read를
  반복하지 않는다. 0건·복수·만료·stale·이전 generation·다른 thread는 안전한 재질문으로 돌아가며
  write/confirmation을 만들지 않는다.
- [ ] **9. 사용자 노출과 write 안전 정책을 공통화한다.** formatter는 internal field, UUID, 후보 식별값,
  선택용 식별값, SQL/exception text를 제거하고 사람·기간·후보만 질문한다. selector나 context가 단일
  대상이어도 Calendar/Board/Meeting 등 mutation은 기존 confirmation·멱등성·실행 직전 권한/상태
  재검증을 반드시 유지한다.
- [ ] **10. cross-domain canonical/held-out eval을 만든다.** capability마다 같은 의미의 말투·어순,
  오타·존댓말·축약, 인접 intent 반례, single-turn, follow-up, 후보 선택 재개를 포함한다. evaluator는
  domain recall@k, tool top-1/sequence, selector field/value, clarification 품질, confirmation 여부,
  supported→unsupported, 반복 tool/clarification, UUID/token 비노출을 상태 기반으로 판정한다.
- [ ] **11. 안전한 운영 관측을 추가한다.** tool 검색 결과 수·선택/미선택 이유, 사용자 정정·tool
  validation rejection·반복 clarification에서 파생한 routing failure signal,
  selector 실패 종류, clarification 반복 횟수, 최종 상태, model/version, latency/token usage만 bounded
  event로 기록한다. raw 사용자 발화·raw tool payload·resource ID·secret은 기본 수집하지 않으며,
  운영 오인식은 익명 taxonomy와 사람이 재작성한 fixture로 eval suite에 반영한다.
- [ ] **12. current/candidate model 비교 harness를 만든다.** 동일 catalog·suite·tool snapshot·기준일·
  timezone·seed에서 `(legacy 전체 tool + current planner)`, `(새 retriever + current planner)`,
  `(동일 retriever + candidate planner)`를 분리해 반복 실행한다. intent뿐 아니라 retrieval recall, tool
  선택, selector, clarification, cost, p50/p95 latency를 비교하고 variance와 실패 유형을 함께 기록한다.
  retriever와 planner를 동시에 바꿔 개선 원인을 섞지 않는다.
- [ ] **13. planner-only rollout gate를 만든다.** candidate가 supported-intent no-regression과 안전성 gate를
  통과하고 품질 이득이 비용·지연 증가보다 명확할 때 feature flag로 planner만 교체한다. App Server tool
  registry, validator, Workspace scope, confirmation, revalidation은 model 선택과 독립적으로 유지하며
  rollback은 planner version 전환만으로 가능해야 한다.
- [ ] **14. domain adapter를 순차 개방하고 E2E를 완료한다.** catalog-only와 retriever shadow로 동작
  변화 없이 관측한 뒤 read capability부터 shortlist planner를 적용한다. Meeting에서 자연어 → Tool 검색 →
  selector → 후보/clarification → original goal 재개 → tool/confirmation을 검증하고 Calendar, Board,
  Canvas·SQLtoERD·PR Review, Drive 순으로 같은 gate를 적용한다. write capability는 각 domain의
  confirmation gate 통과 뒤 활성화하며 UI·run/step·server-side context·SQS readback과
  suite/catalog/tool snapshot SHA를 기록한다.

#### Phase 4 dev 개방 구현 체크리스트 — #1393

> 목표: Phase 4 전체의 domain 확장보다 먼저, dev에서 팀원이 Meeting Agent의 planner routing을 켜서
> lookup → 후보 선택 → original goal 재개를 실제로 검증할 수 있게 한다. 이 단계는 production rollout이나
> App Server의 권한·confirmation·실행 직전 재검증 경계를 변경하지 않는다.

- [ ] **A. runtime 계약과 flag를 고정한다.** App Server가 eligible schema snapshot·catalog SHA·request
  context를 Worker job에 전달하고, Worker는 `legacy`, `shadow`, `shortlist` routing mode를 명시적으로
  기록한다. planner routing flag는 dev의 모든 Workspace에서 기본 on으로 두되, 즉시 전체를 legacy로
  되돌리는 kill switch를 제공하며, 요청 단위 mode와 catalog/snapshot SHA를 run/step에 남긴다.
- [ ] **B. Meeting capability routing을 연결한다.** Meeting read capability와 current-meeting control
  capability를 catalog에서 검색해 bounded shortlist와 필수 chain tool만 planner에 전달한다. shortlist 밖
  tool name·field는 normalization에서 거부하고, retrieval error·낮은 confidence·빈 후보는 write를 만들지
  않은 채 안전한 clarification으로 끝낸다.
- [ ] **C. selector와 Phase 3 재개를 planner 경로에 연결한다.** lookup 결과가 0건·복수·만료·stale이면
  server-owned candidate generation을 사용한 clarification으로 멈춘다. 후보 버튼 선택 뒤에는 original
  goal·이미 완료한 lookup·현재 selector를 재사용해 다음 tool/confirmation으로 재개하고, 이전 generation·다른
  run/thread의 ordinal·candidate는 거부한다.
- [ ] **D. dev 관측 event를 완성한다.** raw 발화·raw payload·resource reference 없이 routing mode,
  candidate/shortlist 수, 선택·fallback·clarification·validation-rejection 이유, selector failure taxonomy,
  resume 여부, tool/confirmation 최종 상태, catalog/snapshot/model version, latency/token만 bounded event로
  남긴다. 운영 event의 resource ID·UUID·token 노출은 테스트로 차단한다.
- [ ] **E. feature flag fallback과 rollback을 검증한다.** flag off는 기존 all-eligible planner와 동일한
  결과를 유지하고, flag on에서 provider·retriever·catalog 오류가 나면 write를 실행하지 않고 clarification
  으로 끝낸다. flag를 즉시 off하면 새 배포 없이 legacy 경로로 되돌아가는 integration test와 dev runbook을
  추가한다.
- [ ] **F. Meeting dev E2E와 eval gate를 추가한다.** (1) 최신/상대 날짜 회의록 lookup, (2) 복수 후보
  버튼 선택, (3) 선택 후 요약·참여자 조회·현재 회의 나가기 재개, (4) unsupported/모호 요청 clarification,
  (5) stale·만료·다른 thread 선택 거부, (6) confirmation-required mutation 비자동 실행을 canonical/held-out
  regression과 dev 수동 시나리오로 검증한다.
- [ ] **G. dev 개방 gate를 판정한다.** 아래 최소 조건을 모두 만족하면 dev의 모든 Workspace를 팀원에게
  개방한다.
  - [ ] dev 배포에서 planner routing flag를 on/off할 수 있고, off가 즉시 legacy planner를 복구한다.
  - [ ] Meeting lookup → 후보 선택 → original goal 재개가 동일 run/thread에서 동작한다.
  - [ ] retrieval·selector·candidate 오류는 write 없이 clarification으로 끝난다.
  - [ ] run/step 또는 운영 event에서 tool 선택과 fallback/실패 taxonomy를 확인할 수 있다.
  - [ ] canonical·held-out·multi-turn regression, privacy 검증, flag-on/flag-off integration test가 통과한다.

#### Phase 4 확정 기본값과 후속 조정 항목

- [x] **검색 방식** — domain/action metadata filter와 semantic rerank를 결합한 2단계 검색을 기본으로 한다.
  초기 retrieval 후보 `topK`는 8개로 시작하되 capability의 필수 chain tool은 schema token budget 안에서
  별도로 포함하고, 실제 baseline의 recall@k·비용·지연 결과로 조정한다.
- [x] **dev 낮은 confidence·retrieval 오류 정책** — bounded domain 확장 뒤에도 shortlist recall을
  보장할 수 없거나 provider·retriever·catalog 오류가 나면, dev 실행 경로는 legacy planner를 자동 호출하지
  않고 clarification으로 종료한다. 즉시 kill switch로 legacy 경로를 복구할 수 있으며, 어느 경우에도
  mutation을 임의 실행하거나 supported 요청을 `unsupported`로 단정하지 않는다.
- [x] **모델 교체 범위** — planner model만 current/candidate 비교 대상으로 하고 App Server 검증 경계와
  tool 실행 코드는 동일하게 유지한다.
- [x] **관측 privacy** — raw 발화와 resource reference는 기본 수집하지 않는다. 익명 error taxonomy와
  aggregate metric을 수집하고, 평가 case는 사람이 재작성해 저장한다.
- [x] **도메인 개방 방식** — Meeting을 첫 adapter·복합 수용 기준으로 유지하되 공통 descriptor와
  retriever는 처음부터 domain-neutral로 구현한다. 이후 domain은 eval gate를 통과한 adapter만 순차 등록한다.
- [x] **dev flag 노출 범위** — dev의 모든 Workspace에서 planner routing을 기본 활성화한다. 단일
  environment kill switch는 유지하며 production 활성화는 별도 rollout gate로 판단한다.
- [x] **Meeting 초기 capability 범위** — Meeting read capability와 현재 회의 나가기를 우선 활성화한다.
  그 외 mutation은 기존 confirmation·권한·상태 재검증을 통과할 때만 실행한다.
- [x] **Meeting 상대 날짜 기본값** — Workspace timezone의 최근 **7개 완료된 calendar day**를
  `from` inclusive, 오늘 시작 시각을 `to` exclusive로 사용한다. “최근 3건”처럼 수량이 있으면 기간
  대신 limit/정렬을 우선한다.
- [x] **모호한 상대 날짜 정책** — “지난주”, “다음 주”는 ISO week(월요일 시작)로 해석하고,
  “주말”, “며칠 전”, 날짜 없는 “그때”는 clarification을 요청한다.
- [x] **follow-up 원래 목표 보존 범위** — 후보 선택이 필요한 바로 직전 unresolved tool request 하나만
  15분 동안 server-owned run state에 보존하고, 다른 run/thread의 미완료 목표는 자동 재개하지 않는다.

### Phase 4.5. Multi-turn Memory와 thread context — 긴급 / #1355

> 관련 Issue: [#1355 — multi-turn memory로 대화 context 유지](https://github.com/Developer-EJ/PILO/issues/1355)
>
> 우선순위: 같은 run 안의 selector만으로는 “그 회의록”, “방금 보여준 2번 작업”, “그 일정으로
> 다시 잡아줘”를 다음 메시지에서 안전하게 처리할 수 없다. Meeting Agent의 자연어 selector 구현과
> 병행하되, 이 foundation을 먼저 확정한다.

#### 제품·보안 계약

- Agent는 서버가 만든 `threadId`를 Workspace와 요청 사용자에 묶어 관리한다. 클라이언트가
  `workspaceId`, `userId`, resource ID를 thread context로 주입할 수 없다.
- 첫 요청에서만 thread를 생성한다. 서버 `last_activity_at`이 1시간 이내면 새로고침 뒤의 다음
  요청도 같은 thread를 자동 복구하고, 1시간이 지나면 다음 요청은 새 thread를 자동 생성한다.
  “새 대화” 버튼·thread 목록은 제공하지 않으며 브라우저 시간이 이 판단을 대신하지 않는다.
- pending confirmation이 있는 thread는 1시간 경과만으로 분리하거나 삭제하지 않는다. 승인·거절 또는
  기존 confirmation 만료 정책까지 confirmation과 thread를 보존한다.
- 각 run은 하나의 thread에 연결된다. planner에는 해당 thread의 최근 bounded turn과 안전한
  resource reference만 전달하며, 다른 사용자·다른 Workspace·다른 thread의 문맥은 읽지 않는다.
- durable memory에는 사용자 prompt, 사용자에게 이미 표시된 final answer, resource type과 내부
  reference만 저장한다. transcript excerpt, Activity Log raw metadata, tool raw input/output, token,
  secret, provider raw payload는 저장·SQS 전달·planner prompt에 넣지 않는다.
- 직전 turn의 reference가 정확히 하나면 내부 ID를 사용하기 전에 현재 Workspace와 사용자 권한을
  다시 검증한다. 0개 또는 여러 개면 raw UUID를 묻거나 임의 선택하지 않고 사람이 읽을 수 있는
  후보 또는 clarification으로 끝낸다.
- write 요청은 context로 대상을 찾았더라도 기존 confirmation을 건너뛰지 않는다. 승인 시점에도
  대상 resource·권한·상태를 다시 검증한다.
- context window의 turn 수·총 byte budget·보존 기간은 server constant와 DB cleanup 정책으로
  고정한다. 요약이나 오래된 turn 정리는 원본 transcript를 다시 저장하지 않는 방향으로 설계한다.

#### 구현 체크리스트

- [x] Agent run/step/outbox/confirmation과 Meeting selector의 현재 lifecycle을 다시 확인하고,
  기존 `agent_run_messages`의 run 내부 multi-turn과 run 간 thread memory의 경계를 확정한다.
- [x] Agent owner와 DB Schema owner 검토 뒤 새 migration으로 `agent_threads`와
  `agent_runs.thread_id`를 추가한다. 새 message table은 만들지 않고 기존
  `agent_run_messages`, terminal run의 prompt/final answer, tool step의 safe `resourceRefs`를
  context source로 재사용한다. 공개 table은 all-deny RLS를 유지한다.
- [x] `POST /agent/runs`와 run detail 응답에 thread 연결 계약을 추가한다. thread 생성·재사용은
  서버가 결정하며 request body의 사용자·Workspace context 주입은 거부한다.
- [ ] App Server가 thread context를 정렬·sanitize·byte 제한하고, resource reference를 현재
  Workspace·사용자 기준으로 재검증해 planner handoff에 필요한 최소 projection만 만든다.
- [ ] AI Worker planner가 bounded context에서 “그 회의”, “방금 회의록”, “2번 후속 작업”을
  selector로 해소한다. 후보가 불명확하면 `needs_clarification`으로 끝내며 write candidate를
  만들지 않는다.
- [ ] Frontend Agent widget은 `threadId`를 선택하거나 생성하지 않고 서버가 복구한 현재 thread의
  run 상태만 표시한다. 새로고침 뒤 1시간 이내 thread를 자동 복구하고, 1시간 경과 뒤 다음 요청에서
  서버가 새 thread를 만드는 정책을 검증한다. “새 대화” 버튼과 thread 목록은 추가하지 않는다.
- [ ] 동일 thread의 동시 전송·retry, thread 간 isolation, cross-user/workspace 차단, bounded
  cleanup, reload 복구, context 기반 write confirmation 재검증을 App Server·AI Worker·Frontend
  회귀에 추가한다.
- [ ] dev E2E에서 이전 turn의 단일 MeetingReport/Meeting/action item 참조, 0/N 후보
  clarification, context를 이용한 write confirmation, UI·DB·SQS readback을 같은 시간창으로
  대조한다.

#### 세부 구현 순서와 commit 단위 체크리스트

- [ ] **1. 현재 계약과 회귀 기준 고정** — `074_create_meeting_agent_workflow.sql`의
  `agent_run_messages`와 `/runs/{runId}/inputs`가 같은 run만 이어 주는 현재 경계를 테스트로
  고정한다. 기존 `waiting_user_input`·turn budget·outbox `turn_sequence` 동작은 바꾸지 않는다.
- [x] **2. Thread DB migration** — `agent_threads`에 `id`, `workspace_id`,
  `requested_by_user_id`, `created_at`, `updated_at`, `expires_at`, `last_activity_at`을 추가한다.
  `agent_runs.thread_id` FK를 추가하고 `(workspace_id, requested_by_user_id, last_activity_at DESC)`
  및 run lookup index를 둔다. RLS는 enabled, policy 0(all-deny)로 유지한다. 현재 구현은 thread를
  삭제할 때 run의 `thread_id`를 `SET NULL`로 보존한다.
- [x] **3. Thread ownership service** — App Server가 Workspace·요청 사용자별 advisory lock 안에서
  유효한 thread를 재사용하거나 새로 만든다. 클라이언트는 `threadId`를 보내거나 선택할 수 없고,
  1시간 경과 thread도 유효 pending confirmation이 있으면 재사용한다.
- [x] **4. Run 생성·idempotency 연결** — `POST /agent/runs`는 server-owned thread에만 새 run을
  연결하고 응답·목록·상세에 `threadId`를 포함한다. `clientRequestId` 재시도는 기존 run을 반환하며,
  thread 선택은 서버가 수행한다.
- [ ] **5. Bounded context projection** — 새 run을 enqueue할 때 App Server가 같은 thread의 최근
  terminal run만 newest-first로 제한해 읽고, planner 순서에 맞춰 oldest-first projection으로
  만든다. turn 수·전체 byte·resource ref 수는 server constant로 제한하며 prompt, final answer,
  안전한 label/type, opaque context reference key만 포함한다. transcript, Activity metadata,
  raw tool JSON, token·secret·provider raw는 제외한다.
- [ ] **6. Opaque resource reference** — planner에는 UUID 대신 thread 내 `contextRef`를 보낸다.
  Meeting selector가 이를 받으면 App Server가 해당 run/step의 resource ref를 현재 user·Workspace
  기준으로 다시 resolve한다. UUID·다른 thread의 reference·0/N 후보는 tool input으로 바꾸지 않고
  clarification으로 끝낸다.
- [x] **7. Planner·outbox handoff** — SQS에는 raw context를 넣지 않는다. AI Worker는 run id와
  현재 outbox `turnSequence`를 검증한 server-side repository read로 같은 thread의 완료 run을
  조회한다. 이전 generation job은 무시하고, thread context가 없어도 새 run 자체는 실패시키지 않는다.
- [ ] **8. Meeting planner policy** — “그 회의록”, “방금 보여준 2번 작업”, “그 회의 나가줘”는
  단일 `contextRef`일 때만 Meeting selector/tool 후보로 만든다. write는 context로 target을
  해소해도 confirmation과 승인 시 재검증을 필수로 하고, 여러 후보면 후보 정보를 담은
  `needs_clarification`을 반환한다.
- [ ] **9. Frontend thread lifecycle** — Agent widget은 server-owned thread를 request에 주입하지 않는다.
  reload 뒤 최근 run 상태로 자동 복구하되, 1시간 이내 재사용·1시간 경과 다음 요청의 새 thread 생성·
  pending confirmation 보존 판단은 서버 `last_activity_at`만 따른다. 진행 중 run의 중복 전송을 막고,
  “새 대화” 버튼·thread picker·thread 목록은 제공하지 않는다.
- [x] **10. Retention·cleanup** — 만료 thread는 유효 pending confirmation이 없을 때만 cleanup한다.
  현재 `thread_id`는 `SET NULL`로 run을 보존하므로 thread 삭제가 run을 고아로 만들지 않으며,
  active/pending confirmation thread는 만료 전 삭제하지 않는다.
- [ ] **11. App Server 회귀** — thread 생성/재사용, clientRequestId conflict, ownership/404 은닉,
  context byte·turn budget, expired cleanup, opaque ref 검증, pending confirmation과 context write
  재검증을 script test로 추가한다.
- [ ] **12. AI Worker 회귀** — internal context projection sanitizer, stale outbox generation,
  단일/0/N Meeting reference, UUID 유출 금지, context 없는 새 thread와 같은 run 보완 입력의
  회귀를 pytest/eval에 추가한다.
- [ ] **13. Frontend·dev E2E** — reload 자동 복구·1시간 경계의 server-owned thread 분리·concurrent
  submit·pending confirmation 보존을 검증한다. dev에서
  MeetingReport 조회 → “그 회의록 결정사항” → “2번 후속 작업 수정” 흐름을 UI, run/step DB,
  SQS/DLQ, confirmation write 0/1건과 같은 시간창으로 대조한다.

현재 상태: #1355 / PR #1359는 2026-07-17 dev에 병합됐고 CI를 통과했다. DB thread 생성·1시간
재사용/pending confirmation 예외·run 연결·repository 기반 이전 turn 조회·cleanup은 완료됐다. 그러나
worker memory에는 아직 raw resource ID가 포함되고 전체 byte budget도 강제하지 않으므로, opaque
`contextRef`·Meeting selector policy·Frontend lifecycle·dev E2E는 완료 처리하지 않는다.

#### Meeting Agent 수용 예시

| turn | 입력 | 기대 결과 |
| --- | --- | --- |
| 1 | “어제 완료된 회의록 보여줘” | 사람이 읽을 수 있는 report 목록과 안전한 resource reference를 저장 |
| 2 | “그 회의록의 결정사항만 알려줘” | 단일 report reference를 재검증한 뒤 결정사항만 반환 |
| 3 | “2번 후속 작업을 세인에게 넘겨줘” | 단일 action item이면 confirmation, 0/N개면 후보 또는 clarification |
| 새 thread | “그 회의록 요약해줘” | 이전 thread를 추측하지 않고 최근 회의록을 찾거나 자연어 조건을 질문 |

완료 기준: 사용자는 UUID 없이 이전 대화의 Meeting resource를 다음 run에서 안전하게 참조할 수
있고, 모호한 reference·다른 사용자/Workspace·write 우회는 모두 차단된다.

### Phase 5. Domain Adapter Rollout와 조회·요약·근거 답변 품질

각 domain은 tool이 registry에 존재한다는 이유만으로 “열림” 처리하지 않는다. 아래 공통 onboarding
gate를 통과한 adapter만 Phase 4 retriever와 planner shortlist에 노출한다.

- [ ] capability catalog와 compact Tool descriptor가 등록돼 있다.
- [ ] planner-facing selector schema와 App Server resolver/revalidation adapter가 있다.
- [ ] 0/1/N·stale·cross-user/workspace·인접 intent 회귀와 safe candidate formatter가 있다.
- [ ] bounded `contextRef` projection과 clarification/continuation 재개 계약이 있다.
- [ ] canonical/held-out/stateful eval, 관측 event, feature flag와 rollback이 준비돼 있다.
- [ ] domain/API owner가 `mustNotUseFor`, selector 의미, write confirmation 경계를 확인했다.

Meeting은 첫 reference adapter로 아래 품질 기준을 적용한다. 이후 Calendar·Board·Canvas·SQLtoERD·
PR Review·Drive도 같은 gate로 순차 등록하고, 각 도메인의 조회 formatter·근거 품질 기준을 추가한다.

- [ ] 회의방 목록, active Meeting, 경과 시간, 참여자 조회 formatter가 이름·상태·시간을 일관된
  사용자 timezone으로 표시한다.
- [ ] 최근·실패·재시도·기간별 report 조회가 실제 상태와 정렬 조건을 보존한다.
- [ ] 회의록 요약 tool이 사용자가 요구한 summary, discussion, decision, action item section만
  선택적으로 반환할 수 있게 한다.
- [ ] 실패한 report 상세는 안전한 오류 코드·단계와 재시도 가능 여부를 설명하고 provider raw error는
  노출하지 않는다.
- [x] 후속 일정·회의 내용 질문은 transcript와 Activity evidence를 source type별로 구분해 사용한다.
- [x] 결정사항 검증은 같은 decision item을 직접 가리키는 evidence만 반환하고, 근거가 없으면
  “직접 연결된 근거 없음”으로 답한다.
- [ ] 질문과 관련 없는 회의·report·action item source가 최종 답변에 섞이지 않게 검증한다.

완료 기준: 요청한 범위만 근거와 함께 답하고, 미지원 오판이나 근거 혼합이 발생하지 않는다.

### Phase 5.5. 사용자 편집 회의록 정본과 자연어 검색

> 선행 구현: [#1346 — 회의록 내용 편집](https://github.com/Developer-EJ/PILO/issues/1346)는 title·논의사항·결정사항의 저장/조회/UI 편집 계약만 먼저 제공한다. 이 Phase의 Agent selector·RAG 재색인·AI 초안 복원은 #1346 이후 별도 작업으로 진행한다.

[#1346](https://github.com/Developer-EJ/PILO/issues/1346)는 `meeting_reports.title`과 사용자 편집
overlay, decision item별 `user_text`, optimistic `content_version`을 추가했다. transcript와 Activity
evidence RAG는 계속 원본 근거 검색용이며, 사용자가 다듬은 회의록 내용을 Agent 검색 정본으로 쓰기 위한
report-content 색인·selector 계약은 아직 별도 구현이 필요하다.

#### 제품 계약

- [x] MeetingReport에 사용자 표시용 `title`을 추가하고, `title`·`discussionPoints`·`decisions`를
  사용자 편집 가능한 정본으로 제공한다. 최초 제목은 Worker가 생성하되, 이후 사용자 편집이 우선한다.
- [x] transcript, Activity evidence, AI 생성 원본과 기존 evidence reference는 불변 근거로 유지한다.
  사용자가 본문을 편집해도 원본 발언이나 Activity Log를 바꾸거나 삭제하지 않는다.
- [ ] 편집된 논의사항·결정사항에는 `user_edited` provenance와 수정자·수정 시각을 보존한다. Agent와
  UI는 원본 근거를 인용할 때 사용자 편집 문장인지, AI 원본 요약인지 구분해 표시한다.
- [x] 결정사항은 기존 `meeting_report_decision_items`와 source index/evidence 연결을 깨지 않도록
  항목 단위로 편집한다. 전체 `decisions` text는 항목의 표시 순서대로 만든 projection으로 취급한다.
- [x] report 재생성은 사용자 편집본을 덮어쓰지 않는다. 새 Worker 결과는 AI 원본·근거만 갱신하며,
  사용자는 명시적으로 “AI 초안으로 되돌리기”를 선택할 때만 편집본을 교체할 수 있다.

#### API·DB·RAG 작업

- [ ] DB Schema owner 검토 후 `meeting_reports` 또는 별도 revision/override 모델에 제목, section별
  사용자 편집본, version, edited_by, edited_at, AI 원본 보존 필드를 추가한다. 동시 편집은
  optimistic version으로 막고, 모든 신규 public table은 all-deny RLS를 적용한다.
- [x] `PATCH /workspaces/{workspaceId}/meeting-reports/{reportId}`에 title, discussionPoints,
  decisions의 부분 수정과 version을 추가한다. 권한은 **해당 Meeting 참석자 또는 Workspace owner**로
  제안하며, update 시 기존 MeetingReport 접근 권한을 재검증한다.
- [ ] 공개 API 문서와 Agent API에 편집 payload, version conflict, AI 초안 복원, provenance 응답을
  같은 변경에서 명시한다. 편집 권한·DB schema는 Meeting owner와 DB Schema owner의 사전 확인이 필요하다.
- [ ] 사용자 편집 저장과 같은 transaction에서 회의록 제목·논의사항·결정사항의 searchable projection을
  갱신한다. keyword search뿐 아니라 의미 기반 검색을 위한 MeetingReport content RAG chunk/job을
  추가하고, 이전 content chunk는 source version/hash가 맞지 않으면 retrieval에서 제외한다.
- [ ] transcript·Activity evidence RAG와 curated report-content RAG를 별도 source type으로 유지한다.
  Agent 답변은 검색된 사용자 정본과 원본 근거를 혼동하지 않으며, 근거 질문에는 기존 직접 evidence
  reference만 사용한다.

#### Agent tool과 자연어 흐름

- [ ] `search_meeting_reports`가 `query`, 날짜·상태·회의방 selector로 제목·논의사항·결정사항을
  검색하고, 단일 결과면 내부 `reportId`를 다음 tool에 전달하며 복수 결과면 selectionToken 후보를
  제시하게 한다.
- [ ] `get_meeting_report`와 section summary tool은 사용자 편집 정본, provenance, 편집 시각을
  반환한다. raw UUID는 답변·질문·confirmation에 노출하지 않는다.
- [ ] `update_meeting_report_content` write tool은 report selector, section, 변경 문장, 예상 version을
  받고 `search_meeting_reports` → 후보 해소 → 변경 preview → confirmation → PATCH를 순서대로
  수행한다. 수정 요청은 confirmation 없이 실행하지 않는다.
- [ ] “어제 디자인 회의 결정사항을 API v2로 바꿔줘”, “지난주 onboarding 회의 제목을 수정해줘”처럼
  reportId 없는 자연어 mutation을 regression eval에 추가한다.

#### 수용 기준과 미결정 사항

- [ ] 제목·논의사항·결정사항 수정 뒤 목록, 상세, Agent 자연어 검색에서 즉시 새 정본이 보인다.
- [ ] 같은 report를 두 사용자가 편집하면 stale version은 `409` conflict로 실패하고 최신 본문을 다시
  보여 준다.
- [x] 재생성·Worker at-least-once callback이 사용자 편집 정본을 덮어쓰지 않는다.
- [ ] 사용자 편집 결정사항에 직접 연결되지 않은 transcript/Activity evidence를 근거로 표시하지 않는다.
- [ ] RAG retrieval은 수정 전 stale chunk를 반환하지 않고, Workspace authorization을 유지한다.
- [ ] 편집 권한(참석자+owner 제안), AI 초안 복원 UX, 결정사항 항목 단위 편집을 구현 시작 전에
  Meeting·DB Schema 담당자와 확정한다.

완료 기준: 사용자는 UUID 없이 자연어로 회의록을 찾고 title·논의사항·결정사항 변경을 confirmation
뒤 저장할 수 있으며, 이후 Agent 검색은 사용자 편집 정본을 우선 사용하고 원본 evidence와 provenance를
보존한다.

### Phase 6. Mutation과 Confirmation

- [ ] 모든 domain의 target selector는 confirmation 전에 App Server adapter로 단일 resource까지 해소한다.
- [ ] confirmation에는 raw ID 대신 사람이 읽을 수 있는 target과 before/after, 영향 범위만 표시한다.
- [ ] 승인 시 target·Workspace 권한·version/status를 다시 검증하고 retrieval/context가 이 경계를
  우회하지 못하게 한다.
- [ ] 복수 write는 step별 멱등 key, 부분 성공 정책, 안전한 retry 범위를 domain 계약으로 고정한다.
- [ ] update → approve처럼 두 개 이상의 write가 필요한 요청은 대상 해소를 먼저 끝낸다.
- [ ] 사용자 confirmation에는 후속작업 제목, 이전·변경 담당자, delivery 대상만 표시한다.
- [ ] action item과 담당자 내부 ID는 confirmation 저장 plan에만 남기고 실행 시 권한·상태를 재검증한다.
- [ ] 승인에 필요한 일정 시각 또는 Board가 없으면 UUID가 아니라 실제 업무 정보를 질문한다.
- [ ] 동일 confirmation 재시도에서 update와 delivery가 중복 실행되지 않게 기존 멱등성 계약을 유지한다.

완료 기준: 모든 등록 domain의 write가 selector/context를 사용해도 confirmation과 승인 시 재검증을
유지한다. Meeting의 “2번을 김세인에게 넘기고 승인”은 대표 복합 수용 사례로 사용한다.

### Phase 7. 공통 Candidate UI와 Domain 상태 동기화

- [ ] candidate UI와 `/inputs` 처리에서 특정 tool name 하드코딩을 제거하고, 최신 server-owned candidate
  generation의 safe label·description·status만 domain formatter로 표시한다.
- [ ] 버튼 선택과 자연어 ordinal 선택이 같은 generation/expiry/one-time-consumption 계약을 사용한다.
- [ ] 선택 만료·재조회·stale·권한 상실을 UI가 내부 ID 없이 설명하고 원래 goal의 재질문으로 복귀한다.
- [ ] tool 완료 뒤 Calendar·Board·Canvas·SQLtoERD 등 변경 domain의 cache/realtime invalidation adapter를
  정의하고, tool 성공과 UI refresh 실패를 별도 상태로 관측한다.

- [ ] Agent 완료 step과 `connect_meeting` action 소비 지점에서 Meeting runtime refresh 경로를 확인한다.
- [ ] join/leave/recording 시작·종료 성공 뒤 active Meeting/header 상태를 즉시 invalidate하고 재조회한다.
- [ ] Realtime event와 HTTP 재조회가 경쟁해 과거 상태로 되돌아가지 않도록 최신 generation만 반영한다.
- [ ] tool 성공 메시지는 나왔지만 header 갱신이 실패한 경우를 관찰 가능하게 기록한다.

완료 기준: 공통 후보 선택이 domain별 하드코딩 없이 동작하고, mutation 뒤 관련 domain UI가 수동
새로고침 없이 기대값으로 바뀐다. Meeting join/leave/recording은 첫 상태 동기화 수용 사례다.

### Phase 8. 통합 검증·Model 전환과 문서 동기화

- [ ] 아래 수용 테스트를 App Server, AI Worker, Frontend E2E에 맞게 분배한다.
- [ ] single-domain과 cross-domain 복합 요청을 current/candidate model에서 같은 fixture로 검증한다.
- [ ] old/new Worker와 catalog/tool schema version의 배포 순서·호환·rollback을 검증한다.
- [ ] per-domain/per-capability 품질 gate로 작은 domain의 퇴행이 aggregate 정확도에 가려지지 않게 한다.
- [ ] current/candidate 비교 보고서에 retrieval, tool/selector/continuation, 비용·지연, 안전성 결과를 남긴다.
- [ ] Workspace 간 ID 주입, 만료 token, 다른 사용자의 run token을 거부하는 보안 테스트를 추가한다.
- [x] tool schema가 확정되면 `MeetingAgentToolMatrix.md`의 현재 구현 상태를 갱신한다.
- [ ] API 계약 변경이 있으면 최신 `docs/api/*.md`를 구현과 함께 갱신한다.
- [ ] 운영 로그에서 UUID clarification과 resolver 0건·복수 건 비율을 확인할 수 있게 한다.

완료 기준: 모든 등록 capability의 수용 기준과 보안/privacy gate가 통과하고, capability catalog·tool
snapshot·eval suite SHA가 일치한다. model 전환은 planner feature flag만으로 rollback 가능해야 한다.

## 9. 수용 테스트

| 영역 | 입력 | 기대 결과 |
| --- | --- | --- |
| 회의방 | “우리 워크스페이스 회의방이랑 진행 중인 방 보여줘” | 이름과 진행 상태만 표시 |
| 시작 | “Backend 회의방에서 회의 시작해줘” | 이름으로 방 해소 후 confirmation/실행 |
| 참여 | “EJ에서 진행되는 회의에 들어가줘” | active Meeting 해소 후 연결 action |
| 나가기 | “현재 회의에서 나가줘” | 현재 참여 Meeting에서 나가고 header 갱신 |
| 참여자 | “오늘 EJ 회의에 누가 참여했어?” | 날짜·방으로 회의를 찾아 참여자 표시 |
| 시간 | “지금 회의 몇 분째야?” | 현재 회의 경과 시간 표시 |
| 현재 회의 | “내가 지금 들어가 있는 회의가 뭐야?” | 회의와 방, 시작 시각·상태 표시 |
| 녹음 | “녹음 끝내고 회의록 만들어줘” | 현재 회의 녹음 종료 후 report 생성 요청 |
| 최근 회의록 | “최근 회의록 보여줘” | 최신 report의 상태와 요청 가능한 요약 표시 |
| 상태별 회의록 | “최근 재시도한 회의록 보여줘” | 재시도 시각·상태 기준의 올바른 report 표시 |
| 실패 원인 | “가장 최근에 실패한 회의록은 왜 실패했어?” | 최신 실패 report의 안전한 오류 설명 |
| 날짜별 요약 | “어제 회의 결정사항과 후속 작업만 알려줘” | 어제 report를 찾아 필요한 부분만 표시 |
| 근거 | “그 후속 일정이 나온 근거가 뭐야?” | 직전 report/action item의 직접 근거 표시 |
| 결정 검증 | “그 결정의 실제 활동 근거도 보여줘” | 같은 decision item의 Activity evidence만 표시 |
| 내 작업 | “내가 맡은 회의 후속 작업이 뭐야?” | report ID 없이 현재 사용자 작업 검색 |
| 담당자 | “김진호가 맡은 회의 후속 작업이 있을까?” | 이름으로 구성원을 찾아 작업 검색 |
| 수정 | “이 회의 2번 후속 작업을 김세인에게 넘겨줘” | 순번·구성원 해소 후 변경 confirmation |
| 순번 mutation | “이 회의의 2번 후속 작업을 김세인에게 넘기고 승인해줘” | 직전 순번·이름 해소 후 confirmation |
| 반려 | “그 후속 작업은 반려해줘” | 직전 작업 해소 후 반려 confirmation |
| 회의록 편집 | “어제 디자인 회의 결정사항을 API v2로 바꿔줘” | report를 자연어로 해소하고 변경 preview·confirmation 뒤 사용자 편집 정본 저장 |
| 모호성 | 같은 이름의 회의나 구성원이 여러 개 | 최대 3개의 사람이 읽을 수 있는 후보 제시 |
| 보안 | 다른 Workspace의 token 또는 resource | 존재 여부를 노출하지 않고 거부 |

공통 assertion은 다음과 같다.

- 사용자가 UUID를 입력하지 않는다.
- Agent의 답변, 질문, confirmation에 raw UUID가 나타나지 않는다.
- 모든 기능 제목에서 원문과 표현 변형이 올바른 intent로 분류된다.
- 등록된 지원 intent를 `unsupported`로 끝내지 않는다.
- canonical·수동 회귀 fixture 100%, held-out paraphrase intent 정확도 95% 이상을 만족한다.
- 질문·상태 조회를 write로 오인하는 critical false positive는 0건이다.
- 결과가 한 건이면 불필요한 질문 없이 원래 요청을 완료한다.
- 복수 후보를 고르면 원래 요청이 같은 run에서 재개된다.
- 요청한 회의록 section과 직접 연결된 evidence만 최종 답변에 포함한다.
- write는 기존 confirmation과 권한 검사를 우회하지 않는다.

## 10. 배포 순서와 관찰

1. regression fixture를 먼저 추가해 현재 실패를 고정한다.
2. read-only resolver와 조회 tool부터 배포한다.
3. 회의 제어와 후속작업 mutation selector를 순서대로 활성화한다.
4. Frontend header invalidation을 함께 배포한다.
5. 제목별 intent 성공률, `unsupported` 오판, UUID clarification, resolver의 0건·복수 건 비율,
   planner turn/tool call 수를 확인한다.

resolver가 모호한 대상을 자동 선택하거나 Workspace 격리를 위반하면 해당 selector 경로를 비활성화하고
기존 사람이 읽을 수 있는 후보 선택으로 되돌린다. raw UUID 입력 요구를 fallback으로 사용하지 않는다.

## 11. 소유·리뷰 경계

- Meeting tool·Meeting domain: 진호
- AI Worker planner·eval: Agent runtime 변경 담당자
- Frontend Meeting runtime·header: Meeting Frontend 담당자
- DB schema 변경이 생기는 경우: 은재 리뷰 필수
- App Server 공통 영역 변경: `apps/app-server/APP_SERVER_COMMON_AREAS.md` 영향 확인 필수
- Frontend 공통 영역 변경: `apps/frontend/FRONTEND_COMMON_AREAS.md` 영향 확인 필수

## 12. 관련 문서

- [Meeting Agent Tool 매트릭스](MeetingAgentToolMatrix.md)
- [Meeting Agent 다단계 Workflow 설계](MeetingAgentWorkflowDesign.md)
- [Agent API](api/agent-api.md)
- [Meeting API](api/meeting-api.md)
- [Agent Tool 개발 가이드](AgentToolGuide.md)
