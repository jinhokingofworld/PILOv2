# PILO MVP 통합 기능 명세서

문서 버전: Draft 1
작성일: 2026-07-03
작성 기준: 팀원 기능명세서 취합본

## 0. 통합 기준

이 문서는 다음 기능명세서를 하나의 MVP 기준으로 합친다.

- PR 리뷰 기능 명세서
- PILO GitHub Project Kanban 기능명세서
- GitHub 연동 기능 명세서 v1
- 회의/녹음/회의록 기능 명세서
- PILO 캔버스 기능 명세서
- 캘린더 일정 기능 명세
- sqltoerd MVP Session 기능 명세서

통합 원칙은 다음과 같다.

1. 각 기능은 Workspace 안에서 동작한다.
2. GitHub 데이터는 GitHub 연동 모듈이 가져오고, 칸반과 PR 리뷰는 그 데이터를 사용한다.
3. 자유형 캔버스는 시각 도형만 소유한다. GitHub, PR 리뷰, 회의, 일정 데이터를 직접 변경하지 않는다.
4. PR 리뷰 캔버스와 자유형 캔버스는 다른 기능이다.
5. 캘린더는 MVP에서 `일정`만 다룬다. 이슈, PR, 회의록을 자동으로 일정에 섞지 않는다.
6. 회의 기능은 MVP에서 고정 회의 페이지 1개를 기준으로 한다. 별도의 MeetingRoom 관리 기능은 제외한다.
7. 사용자가 GitHub에 실제로 쓰기 동작을 수행하는 기능은 명확히 제한한다.
8. sqltoerd는 자유형 캔버스의 하위 도구가 아니라 Workspace 안의 독립 기능이다.

## 1. 제품 개요

PILO MVP는 개발팀이 한 Workspace 안에서 GitHub 프로젝트 운영, PR 리뷰, 회의, 캔버스 기록, 일정 관리, SQL DDL 기반 ERD 확인을 수행하는 협업 서비스다.

MVP의 핵심 사용자 흐름은 다음과 같다.

1. 사용자가 로그인하고 Workspace에 들어간다.
2. Workspace Owner/Admin이 GitHub App을 연결한다.
3. Repository, Issue, Pull Request, ProjectV2 데이터를 동기화한다.
4. 사용자는 GitHub ProjectV2 기반 칸반보드에서 이슈와 PR 상태를 확인한다.
5. 리뷰어는 open PR을 선택해 AI 분석 기반 PR 리뷰 세션을 시작한다.
6. 리뷰어는 파일별 diff를 확인하고 리뷰 판단과 메모를 남긴다.
7. 리뷰어는 결과를 GitHub PR Review body로 제출한다.
8. 사용자는 음성 회의를 진행하고, 녹음 종료 후 STT/LLM 기반 회의록을 생성한다.
9. 사용자는 자유형 캔버스에서 메모, 도형, 코드블럭 등을 저장한다.
10. 사용자는 월간 캘린더에서 일정만 생성, 조회, 수정, 삭제한다.
11. 사용자는 sqltoerd에서 PostgreSQL/MySQL DDL을 입력하고 ERD table card와 FK relation line을 확인한다.

## 2. 사용자와 권한

### 2.1 사용자 유형

| 사용자 | 설명 | 주요 권한 |
| --- | --- | --- |
| Workspace Owner/Admin | Workspace 설정과 GitHub 연결을 관리하는 사용자 | GitHub App 설치, installation 해제, full sync 실행, 보드 hydrate |
| Workspace Member | Workspace에 참여한 일반 사용자 | 보드 조회, 이슈 상세 조회, PR 조회, 회의 참여, 캔버스 사용, 일정 관리, sqltoerd session 사용 |
| PR Reviewer | PR 리뷰를 수행하는 사용자 | PR 리뷰 세션 생성, 파일별 리뷰 결정, GitHub Review 제출 |
| Read-only 사용자 | GitHub 또는 Workspace 권한이 읽기 전용인 사용자 | 조회 가능, 쓰기 기능 비활성화 |
| GitHub App | GitHub installation 권한으로 데이터를 가져오는 시스템 주체 | Repository, Issue, PR, ProjectV2 동기화 |
| GitHub OAuth User | 사용자의 GitHub 계정 연결 | GitHub PR Review 제출 |

Workspace 역할/멤버십 모델은 다음 스프린트에서 확정한다. 이 문서의 Owner/Admin/Member/Read-only 구분은 기능 경계를 설명하기 위한 목표 역할이며, 이번 스프린트에서 세부 테이블과 판정 정책을 확정하지 않는다.

### 2.2 공통 권한 규칙

- 모든 Workspace API는 로그인 사용자를 요구한다.
- 사용자는 접근 권한이 있는 Workspace의 데이터만 조회할 수 있다.
- private repository 데이터는 권한 확인 전 노출하지 않는다.
- GitHub App installation token은 서버에서만 다룬다.
- 사용자 GitHub OAuth token은 암호화 저장하며 API 응답과 로그에 노출하지 않는다.
- localStorage에는 access token, webhook secret, client secret을 저장하지 않는다.
- 예외적으로 회의 녹음 동의 여부는 MVP에서 `localStorage.recordingConsentAccepted`에 저장한다.

## 3. MVP 기능 범위

### 3.1 포함 범위

| 영역 | MVP 포함 기능 |
| --- | --- |
| 인증/사용자 | 로그인 사용자 정보 사용, 등록자 표시, GitHub OAuth 연결 상태 |
| Workspace | Workspace 단위 데이터 격리, 역할 기반 접근 제어 |
| GitHub 연결 | GitHub App installation, 사용자 GitHub OAuth 연결 |
| GitHub 동기화 | repository, issue, pull request, ProjectV2, field, option, item 동기화 |
| 칸반 | ProjectV2 기반 로컬 보드 hydrate, lane별 이슈 조회, 검색, 기본 필터, 상세 패널, 상태 이동 |
| PR 리뷰 | open PR 목록/상세, AI 분석, Flow/Node/Edge 리뷰 캔버스, 파일별 diff와 판단, GitHub Review 제출 |
| 회의 | 고정 회의 페이지, LiveKit 음성 회의, 녹음, STT, LLM 회의록, 실패 재시도 |
| 자유형 캔버스 | Workspace 캔버스, 자유 도형 CRUD, 화면 위치 저장, 입장/퇴장 기록 |
| 캘린더 | 월간 일정 조회, 일정 생성/수정/삭제, 상세 모달, 우측 일자 패널 |
| sqltoerd | PostgreSQL/MySQL DDL 입력, ERD model 생성, tldraw table card 렌더링, FK relation line 표시, Inspector 조회, Workspace session 저장/복원 |
| 운영 상태 | sync run 상태, 저장 실패, 제출 실패, 권한 부족, rate limit, webhook 실패 표시 |

### 3.2 제외 범위

| 제외 기능 | 설명 |
| --- | --- |
| Workspace 역할/멤버십 세부 모델 | 이번 스프린트에서는 확정하지 않고 다음 스프린트에서 별도 명세로 다룬다. |
| GitHub repository 생성/삭제 | MVP는 GitHub 원본 데이터를 동기화한다. |
| GitHub issue 생성/수정 | MVP에서 이슈 제목, 본문, assignee, label, milestone 직접 수정은 제외한다. |
| GitHub ProjectV2 field/option 생성/수정 | ProjectV2 원본 설정은 GitHub에서 관리한다. |
| PR merge/close | Merge 버튼은 보여도 실제 merge API는 호출하지 않는다. |
| closed/merged/draft PR 리뷰 대상 조회 | PR 리뷰 화면은 open PR만 조회한다. |
| GitHub inline review comment | 파일별 comment는 Review body에만 포함한다. |
| 칸반 AI agent | 자동 추천, 자동 작업 생성, 자동 리뷰는 칸반 MVP에서 제외한다. |
| 자유형 캔버스 실시간 협업 | CRDT, WebSocket 동시 편집, 커서 공유, 하트비트는 제외한다. |
| MeetingRoom 관리 | 방 목록, 방 생성, 여러 회의실 관리는 제외한다. |
| 비정상 회의 disconnect 보정 | 브라우저 강제 종료, 네트워크 단절 보정은 추후 LiveKit webhook으로 확장한다. |
| 캘린더 반복 일정/알림/외부 캘린더 연동 | MVP 캘린더는 내부 일정 CRUD만 제공한다. |
| sqltoerd 고급 편집/공유/내보내기 | Local-only 저장, JSON import/export, PNG/SVG export, theme 전환, inline edit, Add column, model-to-SQL 재생성, BigQuery CTE, Prisma/DBML/Mermaid/PlantUML/SQLAlchemy/Sequelize, Sticky note, Group box, Manual arrow, URL 공유, 실시간 협업은 제외한다. |
| 대량 편집/멀티레포 보드/고급 리포트 | MVP 이후 확장으로 둔다. |

## 4. GitHub 연동

### 4.1 목적

GitHub 연동 모듈은 Workspace에 GitHub App installation을 연결하고, GitHub repository, issue, pull request, ProjectV2 데이터를 PILO DB에 동기화한다.

### 4.2 사용자 GitHub OAuth 연결

기능:

- 사용자는 자신의 GitHub 계정 연결 상태를 조회할 수 있다.
- 연결되지 않은 사용자는 GitHub OAuth 시작 URL을 받을 수 있다.
- OAuth callback 성공 시 사용자 GitHub 정보를 저장한다.
- 사용자는 GitHub 연결을 해제할 수 있다.
- PR Review 제출은 사용자 GitHub OAuth token으로 수행한다.

저장 항목:

- `github_user_id`
- `github_login`
- `github_access_token_encrypted`
- `github_token_scope`
- `github_connected_at`
- `github_revoked_at`

상태:

| 상태 | 조건 |
| --- | --- |
| 미연결 | `github_connected_at` 없음 |
| 연결됨 | `github_connected_at` 있음, `github_revoked_at` 없음 |
| 해제됨 | `github_revoked_at` 있음 |

수용 기준:

- 연결되지 않은 사용자는 `connected=false`를 받는다.
- access token은 평문으로 DB에 저장되지 않는다.
- 해제된 사용자는 PR Review 제출 시 다시 연결하라는 안내를 받는다.

### 4.3 Workspace GitHub App Installation

기능:

- Owner/Admin은 GitHub App 설치 URL을 생성할 수 있다.
- 설치 URL에는 Workspace 식별 정보를 포함한 signed state가 포함된다.
- callback에서 state를 검증하고 installation 정보를 저장한다.
- 사용자는 Workspace에 연결된 installation 목록을 조회할 수 있다.
- Owner/Admin은 installation 연결을 해제할 수 있다.

저장 항목:

- `workspace_id`
- `github_installation_id`
- `account_login`
- `account_type`
- `repository_selection`
- `permissions`
- `installed_by_user_id`
- `installed_at`

권한:

| 동작 | 권한 |
| --- | --- |
| 설치 URL 생성 | Workspace Owner/Admin |
| callback 처리 | signed state로 Workspace 확인 |
| installation 목록 조회 | Workspace Member 이상 |
| installation 해제 | Workspace Owner/Admin |

### 4.4 수동 동기화

동기화 대상:

| target | 설명 |
| --- | --- |
| `repositories` | installation 접근 가능 repository 목록 |
| `issues` | repository별 issue |
| `pull_requests` | repository별 PR |
| `project_v2` | GitHub ProjectV2 목록/상세 |
| `project_v2_fields` | ProjectV2 field 및 option |
| `project_v2_items` | ProjectV2 item 및 field value |
| `full` | 위 대상 전체 |

동작:

- sync run 시작 시 `running` 상태를 저장한다.
- 완료 시 `success`, 실패 시 `failed`로 종료한다.
- `fetched_count`, `created_count`, `updated_count`, `skipped_count`를 기록한다.
- 실패 시 `error_message`를 저장한다.
- pagination cursor는 저장해서 재개할 수 있어야 한다.
- 동일 대상 sync가 실행 중이면 중복 실행을 막는다.

### 4.5 Webhook

기능:

- 서버는 `/api/v1/github/webhooks`로 GitHub webhook을 수신한다.
- `X-Hub-Signature-256` HMAC-SHA256 검증을 통과한 요청만 처리한다.
- 중복 delivery id는 별도 webhook delivery 저장 테이블을 기준으로 멱등 처리한다.
- 즉시 처리하기 어려운 이벤트는 sync run 또는 background job으로 넘길 수 있다.

처리 대상:

| Event | 처리 |
| --- | --- |
| `installation` | installation 상태 반영 |
| `installation_repositories` | repository 연결 변경 반영 |
| `repository` | repository 메타데이터 반영 |
| `issues` | issue 데이터 반영 |
| `pull_request` | PR 데이터 반영 |
| `projects_v2_item` | ProjectV2 item 변경 반영 |

## 5. GitHub Project Kanban

### 5.1 목적

GitHub Project Kanban은 GitHub Issues, Pull Requests, Projects v2 상태를 한 화면에서 확인하고 처리하는 프로젝트 운영 화면이다.

첫 화면은 보드 자체여야 하며, 랜딩 페이지나 설명 중심 화면을 두지 않는다.

### 5.2 전역 레이아웃

Desktop:

- 좌측 사이드바
  - 브랜드
  - 현재 연결 repository
  - Board, Repos, PRs, Milestones, Settings
  - Live sync 상태
- 우측 workspace
  - 보드 제목
  - 검색/필터
  - summary chip
  - 5개 lane 칸반보드
  - 이슈 상세 drawer

Tablet:

- sidebar는 상단 또는 축약형 nav로 전환한다.
- 보드는 가로 스크롤을 유지한다.
- 상세 패널은 420px-520px drawer로 연다.

Mobile:

- sidebar는 상단 block으로 전환한다.
- 검색은 전체 폭을 사용한다.
- 필터는 `Filter` 버튼 하나로 합친다.
- 보드는 lane 단위 가로 스크롤을 사용한다.
- 상세는 bottom sheet로 연다.

### 5.3 Lane

기본 lane:

| Lane | 의미 | GitHub Project Status 매핑 |
| --- | --- | --- |
| Backlog | 아직 정리 중인 이슈 | Backlog 또는 Todo |
| Ready | 다음 작업 후보 | Ready |
| In Progress | 진행 중 | In Progress |
| Review | PR 리뷰/검수 중 | Review |
| Done | 완료됨 | Done |

규칙:

- GitHub issue의 `open/closed` 상태와 보드 lane 상태는 분리한다.
- Done 이동은 자동 issue close가 아니다.
- MVP에서 issue close는 별도 명시 액션이 없는 한 수행하지 않는다.
- ProjectV2 Status field가 없으면 `Unmapped` 컬럼을 생성하고 설정 필요 상태를 표시한다.

### 5.4 Project 선택과 필드 매핑

기능:

- 사용자는 연결된 repository와 관련된 GitHub Projects v2를 선택할 수 있다.
- 프로젝트 목록, 검색, 최근 사용 프로젝트를 제공한다.
- 선택 전 field 구성, item 수, 마지막 업데이트, 권한을 미리 보여준다.
- Status single select field를 PILO lane에 매핑한다.
- Status 값이 없는 item은 `Unmapped` 컬럼에 표시한다.

필수 매핑:

| PILO 필드 | GitHub 필드 후보 |
| --- | --- |
| Lane | ProjectV2 Status single select |
| Title | Issue/PR title |
| Body | Issue body |
| Assignee | Issue assignee |
| Label | Issue labels |
| Milestone | Issue milestone |
| Due date | Project date field 또는 milestone due date |
| Linked PR | closing/reference PR |
| PR status | review decision, checks, merge state |

### 5.5 보드 조회

카드 기본 표시:

- 이슈 번호
- 이슈 제목

카드 표시 규칙:

- 카드에는 상태, 담당자, 라벨, PR, 본문, 댓글, 동기화 정보를 기본 노출하지 않는다.
- 카드 제목은 최대 2줄까지 표시한다.
- lane header에는 lane 이름과 현재 결과 기준 count를 표시한다.
- summary chip에는 open, blocked, due soon, done 등 주요 상태 개수를 표시한다.
- 검색/필터 적용 시 lane count와 summary count를 재계산한다.

### 5.6 검색

검색 대상:

- issue number
- title
- body
- label
- assignee
- PR number

규칙:

- 입력은 debounce 처리한다.
- 검색 결과는 현재 보드 안에서 필터링한다.
- 검색 시 결과 없음 상태와 필터 초기화 액션을 제공한다.
- 검색어는 URL query에 반영할 수 있다.

### 5.7 필터

기본 필터:

- Mine
- Blocked
- Due
- Review
- Assignee
- Label
- Milestone
- PR status

규칙:

- desktop에서는 주요 필터 버튼을 상단에 표시한다.
- mobile에서는 `Filter` 버튼과 bottom sheet를 사용한다.
- summary chip 클릭 시 해당 필터를 적용한다.
- 활성 필터 상태와 clear-all 액션을 제공한다.

### 5.8 이슈 상세 패널

카드를 클릭하면 상세 패널을 연다.

표시 정보:

- 이슈 번호
- 이슈 제목
- 이슈 본문
- 보드 상태
- PR 번호
- assignee
- labels
- milestone
- due date
- GitHub 원문 링크
- sync status
- permission status

MVP 수정 범위:

- 보드 lane/status 변경은 지원한다.
- GitHub issue 제목, 본문, assignee, label, milestone, due date 직접 수정은 통합 MVP에서 제외한다.
- 위 필드들은 조회 중심으로 제공한다.

상세 패널 규칙:

- desktop/tablet에서는 오른쪽 drawer로 연다.
- mobile에서는 하단 sheet로 연다.
- header에는 `#번호 + 제목`을 표시한다.
- 선택된 카드는 보드에서도 하이라이트한다.
- read-only 권한 사용자는 입력과 저장 액션이 비활성화된다.
- 저장 중, 저장 완료, 저장 실패 상태를 표시한다.

### 5.9 상태 변경

지원 방식:

- 상세 form의 status select
- desktop drag/drop
- keyboard 기반 이동은 접근성 개선 항목으로 둔다.

규칙:

- lane 이동은 ProjectV2 Status field 업데이트로 처리한다.
- issue open/closed 상태는 자동 변경하지 않는다.
- 이동 직후 optimistic update를 적용한다.
- 실패 시 원래 lane으로 rollback한다.
- 이동 대상 column은 같은 board에 속해야 한다.
- 같은 column 안에서 position은 중복될 수 없다.

### 5.10 PR 상세 Section

이슈와 연결된 PR이 있으면 상세 패널에 `Pull Request` section을 표시한다.

표시 정보:

- PR 번호
- PR 제목
- draft 여부
- review decision
- requested reviewers
- CI/check status
- merge 가능 여부
- GitHub PR 링크

규칙:

- 카드에는 PR 정보를 기본 노출하지 않는다.
- Review lane에서는 PR section 순서를 위로 올린다.
- PR이 없으면 `연결 전`으로 표시한다.

### 5.11 동기화 상태와 오류 복구

표시 위치:

- 사이드바 하단 `Live sync`
- 보드 상단 상태 텍스트
- 상세 패널 footer

표시 항목:

- 마지막 동기화 시각
- 수동 refresh
- 초기 import 진행률
- 실패 항목 재시도
- rate limit, 권한 부족, webhook 실패, conflict 구분

상태:

| 상태 | 처리 |
| --- | --- |
| Loading | skeleton 또는 compact loading |
| Empty repo | GitHub App 설치 CTA |
| Empty project | Project 선택 또는 레포 이슈로 시작 |
| Empty lane | lane 내부 짧은 empty text |
| Empty filter result | 필터 초기화 |
| Read-only | 입력 비활성화 |
| Saving | pending 표시 |
| Save failed | toast와 rollback |
| Sync failed | sync panel과 재시도 |
| Rate limited | Retry-After 기반 대기 |
| Permission denied | 권한 요청 CTA |

## 6. PR 리뷰

### 6.1 목적

PR 리뷰 기능은 GitHub Repository에서 열린 PR 목록을 불러오고, 사용자가 선택한 PR의 변경 파일을 AI가 Flow/Node 형태로 분석해 리뷰 순서를 안내하며, 파일별 리뷰 판단과 메모를 모아 GitHub Review로 제출하는 기능이다.

### 6.2 사용자 흐름

1. 사용자는 PR 선택 화면에 진입한다.
2. 시스템은 연결된 GitHub Repository의 open PR 목록을 조회한다.
3. 사용자는 검색/페이지네이션으로 리뷰할 PR을 찾는다.
4. 사용자가 PR을 클릭하면 PR 상세 모달이 열린다.
5. 사용자가 `리뷰 시작`을 클릭하면 새 PR 리뷰 세션과 AI 분석을 생성한다.
6. AI 분석이 완료되면 PR 리뷰 캔버스로 이동한다.
7. 사용자는 Flow/Node와 추천 리뷰 순서를 확인한다.
8. 사용자가 파일 Node를 클릭하면 파일 노드 리뷰창으로 이동한다.
9. 사용자는 side-by-side diff와 AI 설명을 보고 파일별 리뷰 상태와 comment를 남긴다.
10. 모든 파일의 리뷰 상태가 선택되면 리뷰 제출 모달을 열 수 있다.
11. 사용자는 GitHub Submit Type을 선택하고 reviewBody를 확인/수정한 뒤 제출한다.
12. 시스템은 GitHub Review를 생성한다. line comment는 생성하지 않는다.

### 6.3 PR 선택 화면

화면 구성:

| 영역 | 내용 |
| --- | --- |
| 상단 제목 | `리뷰할 PR을 선택하세요` |
| 검색 영역 | PR 번호 또는 제목 검색 input |
| PR 리스트 | GitHub에서 불러온 open PR 목록 |
| 페이지네이션 | 이전/다음 페이지 이동 |

조회 정책:

- 조회 대상은 `open` PR만이다.
- 기본 정렬은 `updated_at desc`이다.
- 한 페이지당 10개를 조회한다.
- 전체 페이지 수 표시는 필수로 하지 않는다.
- `hasPrev`, `hasNext` 값에 따라 이전/다음 버튼을 활성화한다.

검색 정책:

- 검색어가 없으면 open PR 목록을 페이지네이션으로 조회한다.
- 검색어 입력 시 300ms debounce 후 조회한다.
- 검색어가 숫자면 PR 번호 기준으로 검색한다.
- 검색어가 문자열이면 PR 제목 기준으로 검색한다.
- 검색 시 페이지는 1페이지로 초기화한다.

상태 처리:

| 상태 | 처리 |
| --- | --- |
| Loading | PR 목록 로딩 표시 |
| Empty | `불러온 PR이 없습니다.` 표시 |
| Error | `PR 목록을 불러오지 못했습니다.` 표시 및 다시 시도 |
| GitHub 미연동 | `GitHub Repository를 먼저 연결해주세요.` 표시 |

### 6.4 PR 상세 모달

표시 정보:

- PR 번호
- 제목
- 작성자
- 생성 시간과 상대 시간
- head branch
- base branch
- 변경 파일 수
- 전체 리뷰 파일 수
- 추가/삭제 라인 수
- 커밋 수
- PR Description
- 변경 파일 목록

파일 수 정책:

- `changedFilesCount`와 `totalFileCount`는 항상 같다.
- binary 파일과 large diff 파일도 리뷰 대상에 포함한다.
- lockfile, generated file 등을 자동 제외하지 않는다.

PR 부가 필드 정책:

- MVP에서는 `state`, `draft`, `mergeable`, `head_sha`, `base_sha`를 별도 명시 컬럼으로 추가하지 않는다.
- 위 값은 `github_pull_requests.raw` JSONB 또는 GitHub API 응답에서 파생해 사용한다.
- PR 변경 파일은 GitHub Integration의 별도 원본 캐시 테이블에 저장하지 않고 리뷰 화면 진입/갱신 시 GitHub API에서 조회한다.
- 리뷰 세션 생성 시에는 API 기준대로 변경 파일 metadata를 `review_files`에 저장한다.
- 변경 파일 실시간 조회 성능은 MVP 사용 중 측정하고, 느리다고 판단될 때 GitHub 원본 PR file cache 테이블 도입을 재검토한다.

리뷰 시작 정책:

- 사용자가 `리뷰 시작`을 클릭하는 시점에 새 Review Session과 AI 분석을 생성한다.
- MVP에서 Review Session은 리뷰 화면에 머무는 동안 사용하는 임시 작업 데이터다.
- 사용자가 PR 리뷰 화면을 나가면 프론트는 Review Session 삭제 API를 호출한다.
- 같은 PR을 다시 리뷰하면 이전 화면 세션을 재사용하지 않고 새 Review Session을 생성한다.
- PR의 headSha는 세션 생성 시점에 저장하고, 제출 전 현재 headSha와 비교한다.
- 분석 중에는 `PR을 분석하고 있습니다.` 상태를 표시한다.
- 분석 실패 시 `분석에 실패했습니다. 다시 시도해주세요.`를 표시한다.

### 6.5 PR 리뷰 캔버스

화면 구성:

| 영역 | 내용 |
| --- | --- |
| 상단 헤더 | 뒤로가기, 브랜치 정보, 리뷰 진행률, conflict 상태, Review 제출 버튼, Merge 버튼 |
| 중앙 캔버스 | Flow, 파일 Node, Edge 표시 |
| 우측 패널 | PR 전체 설명, AI 분석, 추천 리뷰 순서, 선택한 Flow 설명 |

진행률 계산:

```ts
reviewedCount = files.filter(file => file.reviewStatus !== "not_reviewed").length
totalFileCount = changedFilesCount
```

규칙:

- `approved`, `discussion_needed`, `unknown` 중 하나가 선택되면 리뷰 완료로 계산한다.
- comment만 입력하고 reviewStatus를 선택하지 않은 파일은 리뷰 완료로 계산하지 않는다.
- Review 제출 버튼은 `reviewedCount === totalFileCount`일 때만 활성화한다.
- 아직 리뷰하지 않은 파일이 있으면 `모든 파일의 리뷰 상태를 선택해주세요.`를 표시한다.

Conflict 상태:

| 상태 | 의미 | UI |
| --- | --- | --- |
| checking | GitHub에서 conflict 여부 확인 중 | `conflict 확인 중` |
| clean | conflict 없음 | `충돌 없음` |
| conflicted | conflict 있음 | `충돌 있음` |
| unknown | 확인 실패 또는 결과 불명확 | `충돌 확인 실패` |

규칙:

- 리뷰 캔버스 진입 시 conflict 상태를 조회한다.
- GitHub `mergeable` 값이 `null`이면 `checking`으로 표시한다.
- `checking` 상태에서는 1.5초 간격으로 최대 5회 재조회한다.
- 재조회 후에도 확정되지 않으면 `unknown`으로 표시한다.
- 실제 merge 기능은 없으므로 conflict 상태는 정보 배지로만 사용한다.

Merge 버튼:

- 화면에는 표시한다.
- MVP에서는 실제 merge API를 호출하지 않는다.
- 버튼은 비활성화한다.
- 안내 문구는 `현재 버전에서는 GitHub에서 merge를 진행해주세요.`로 한다.

### 6.6 Flow/Node/Edge

생성 정책:

- Flow/Node/Edge는 AI 분석 결과로 생성한다.
- 사용자는 MVP에서 Flow/Node/Edge를 수정할 수 없다.
- 한 파일은 하나의 Flow에만 속한다.
- Edge는 코드 의존 관계가 아니라 추천 리뷰 순서를 의미한다.
- Node 위치는 프론트엔드에서 자동 배치한다.
- Node 위치는 DB에 저장하지 않는다.
- 자동 배치는 `flow.order`, `node.workflowOrder`를 기준으로 한다.

Node 표시 데이터:

- workflowOrder
- fileName
- filePath
- fileRole
- reviewStatus

Node 색상:

| reviewStatus | 의미 | 색상 의도 |
| --- | --- | --- |
| not_reviewed | 미리뷰 | 중립 회색 |
| approved | 문제 없음 | 긍정 녹색 |
| discussion_needed | 논의/수정 필요 | 주의 노랑/주황 |
| unknown | 판단 불가 | 보류 회색/보라 |

### 6.7 파일 노드 리뷰창

화면 구성:

| 영역 | 내용 |
| --- | --- |
| 상단 | 뒤로가기, 파일 경로, 파일 상태 |
| 좌측 | side-by-side diff viewer |
| 우측 | 파일 역할, 변경 이유, 핵심 변경 내용, 관련 Flow 및 파일, 리뷰 포인트, comment 입력 |
| 우측 하단 | `문제 없음`, `논의/수정 필요`, `판단 불가` 버튼 |

리뷰 판단:

| 버튼 | 저장 값 | 의미 |
| --- | --- | --- |
| 문제 없음 | `approved` | 이 파일은 리뷰상 문제 없음 |
| 논의/수정 필요 | `discussion_needed` | 팀 논의 또는 수정 검토 필요 |
| 판단 불가 | `unknown` | 리뷰어가 판단하기 어려움 |

comment 정책:

- comment는 PILO 내부 파일별 리뷰 메모이다.
- GitHub Review 제출 시 reviewBody에 포함한다.
- GitHub inline comment로는 제출하지 않는다.
- comment는 선택 입력값이다.
- `discussion_needed` 또는 `unknown` 선택 시 comment 입력을 권장하지만 필수는 아니다.
- reviewStatus 변경은 즉시 저장한다.
- comment 변경은 500ms debounce 또는 blur 시 저장한다.

### 6.8 Side-by-side Diff

기본 표시:

- 왼쪽에는 변경 전 코드를 표시한다.
- 오른쪽에는 변경 후 코드를 표시한다.
- 삭제 라인은 왼쪽에 강조 표시한다.
- 추가 라인은 오른쪽에 강조 표시한다.
- 변경되지 않은 context line은 양쪽에 동일하게 표시한다.
- 좌우 스크롤은 동기화한다.
- 각 라인에는 line number를 표시한다.
- line comment 입력 UI는 제공하지 않는다.

파일 상태별 처리:

| fileStatus | 처리 |
| --- | --- |
| modified | 기존 코드와 변경 코드를 side-by-side로 표시 |
| added | 왼쪽에 `새로 추가된 파일입니다.` 표시, 오른쪽에 추가 코드 표시 |
| deleted | 왼쪽에 삭제 코드 표시, 오른쪽에 `삭제된 파일입니다.` 표시 |
| renamed | `oldPath -> newPath` 표시, 내용 변경이 있으면 diff 표시 |
| renamed without changes | `파일명만 변경되었습니다.` 표시 |
| binary | diff viewer 생략, GitHub에서 보기 버튼 제공 |
| large diff | diff viewer 생략, GitHub에서 보기 버튼 제공 |

Large diff 기준:

- `additions + deletions >= 1000`
- `patchSizeBytes >= 200KB`
- GitHub API에서 patch 데이터가 제공되지 않음

### 6.9 리뷰 제출 모달

화면 구성:

| 영역 | 내용 |
| --- | --- |
| 요약 | 문제 없음/논의·수정 필요/판단 불가 파일 수 |
| 파일별 결과 | 파일 경로, 리뷰 상태, comment |
| Submit Type 선택 | `COMMENT`, `APPROVE`, `REQUEST_CHANGES` |
| Review Body | GitHub에 제출할 markdown body |
| 제출 버튼 | GitHub Review 제출 |

Submit Type 정책:

- 사용자가 제출 모달에서 직접 선택한다.
- 자동 결정하지 않는다.
- 기본 선택값은 없다.
- Submit Type 선택 전 제출 버튼은 비활성화한다.

GitHub 제출 정책:

- GitHub Review 본문은 `reviewBody` markdown 문자열로 제출한다.
- GitHub Review API의 line comments 배열은 사용하지 않는다.
- PILO의 리뷰 요약, 파일별 리뷰 결과, 파일별 comment는 reviewBody에 포함한다.
- 제출은 사용자 GitHub OAuth token으로 수행한다.

제출 상태:

| 상태 | 의미 |
| --- | --- |
| not_submitted | 아직 제출하지 않음 |
| submitting | 제출 중 |
| submitted | 제출 완료 |
| failed | 제출 실패 |

## 7. 회의와 회의록

### 7.1 목적

회의 기능은 사용자가 고정 회의 페이지에서 음성 회의를 진행하고, 녹음 종료 후 녹음 파일을 STT와 LLM으로 처리해 회의록을 생성하는 기능이다.

### 7.2 용어

| 용어 | 정의 |
| --- | --- |
| 회의 페이지 | 사용자가 회의에 접속할 수 있는 웹페이지 |
| 회의실 MeetingRoom | MVP 제외. 여러 회의 공간을 관리하는 개념 |
| 회의 Meeting | 실제 진행되는 회의 세션 |
| Recording | 하나의 Meeting 안에서 사용자가 시작하고 종료하는 녹음 단위 |
| MeetingReport | 회의 녹음에서 생성된 회의록 |

MVP 기준:

- 회의 페이지 자체는 고정 회의실의 진입점 역할을 한다.
- `roomKey = "MAIN_MEETING_ROOM"`을 사용한다.
- `roomKey`는 Workspace 안의 기본 회의실 키다.
- `livekitRoomName`은 실제 LiveKit room name이며 Meeting 세션별로 고유해야 한다.
- 같은 `workspaceId + roomKey`에서 `endedAt = null`인 Meeting은 하나만 존재해야 한다.

### 7.3 회의 페이지 진입

기능:

- 사용자가 회의 페이지에 접근한다.
- 페이지 이동 자체는 DB 참여를 만들지 않는다.
- 프론트는 현재 진행 중인 회의가 있는지 조회한다.
- 화면에는 단일 `회의 참여하기` 버튼을 보여준다.
- 사용자가 버튼을 누르면 진행 중 회의가 있을 때는 참여하고, 없을 때는 새 회의를 시작한다.

중복 방지:

```sql
CREATE UNIQUE INDEX unique_active_meeting_per_room
ON meetings (workspace_id, room_key)
WHERE ended_at IS NULL;
```

### 7.4 녹음 동의

규칙:

- 처음 회의 페이지를 이용하는 사용자는 녹음 동의 모달을 봐야 한다.
- 안내 문구는 `회의록 생성을 위해 녹음됩니다`를 포함한다.
- 동의하지 않으면 회의 참여를 막는다.
- 프론트는 녹음 동의가 완료된 사용자에게만 회의 시작/참여 요청을 보낸다.
- 동의 여부는 MVP에서 서버 DB에 저장하지 않는다.
- 동의 여부는 `localStorage.recordingConsentAccepted = true`로 저장한다.

### 7.5 마이크 권한

규칙:

- 브라우저 `getUserMedia` 또는 LiveKit SDK를 통해 마이크 권한을 요청한다.
- 허용 시 회의 참여가 가능하다.
- 거부 시 안내 메시지를 표시한다.
- 마이크 권한은 DB에 저장하지 않는다.

### 7.6 회의 시작과 참여

단일 회의 참여 버튼:

1. 사용자가 `회의 참여하기`를 클릭한다.
2. 서버는 `workspaceId + roomKey` 기준으로 진행 중인 Meeting이 있는지 확인한다.
3. 진행 중 Meeting이 없으면 Meeting을 생성한다.
4. 진행 중 Meeting이 있으면 기존 Meeting에 참여한다.
5. 현재 사용자를 `meeting_participants`에 등록하거나 기존 row를 재입장 상태로 갱신한다.
6. LiveKit Room 이름을 결정한다.
7. 사용자별 LiveKit JWT token을 발급한다.
8. 프론트는 LiveKit Room에 connect하고 Audio Track을 publish한다.
9. 녹음은 자동 시작하지 않는다. 사용자가 `녹음 시작` 버튼을 누를 때 별도 API로 시작한다.

진행 중 회의 참여:

1. 사용자가 `회의 참여하기`를 클릭한다.
2. 서버는 해당 Meeting의 `endedAt`이 null인지 확인한다.
3. 같은 회의에서 같은 사용자는 하나의 participant row를 가진다.
4. 재입장 시 기존 row의 `joinedAt`, `leftAt`을 갱신한다.
5. 서버는 사용자별 LiveKit JWT token을 발급한다.
6. 프론트는 LiveKit Room에 connect한다.

LiveKit token 규칙:

- LiveKit token은 DB에 저장하지 않는다.
- DB에는 `meetingId`, `userId`, `livekitIdentity`, `livekitRoomName`을 저장한다.
- token은 입장 시 서버가 새로 발급한다.
- token 만료 시간은 발급 시점 기준 1시간이다.

### 7.7 회의 진행

DB에 저장하지 않는 실시간 상태:

- 음성 송수신
- 마이크 ON/OFF 표시
- 발화 상태
- 연결 상태

화면 표시:

- 음성 송수신은 LiveKit이 처리한다.
- 마이크 상태는 LiveKit track muted 상태로 표시한다.
- 발화 상태는 LiveKit active speaker 이벤트로 표시한다.
- 연결 상태는 LiveKit connection state로 표시한다.
- header 우측에는 녹음 상태를 표시한다.

### 7.8 녹음

녹음은 LiveKit Egress를 사용한다.

녹음 상태:

```ts
type RecordingStatus = "RUNNING" | "COMPLETED" | "FAILED";
```

규칙:

- Meeting과 Recording은 1:N 관계다.
- 사용자가 `녹음 시작` 버튼을 누르면 서버가 LiveKit Egress 녹음을 시작한다.
- 회의 시작 또는 참여만으로는 녹음을 자동 시작하지 않는다.
- 같은 Meeting 안에서 `RUNNING` 상태 Recording은 하나만 존재할 수 있다.
- `녹음 시작`, `녹음 종료하고 회의록 생성`, STT 요청, LLM 요청은 같은 Recording에 대해 한 번만 수행되어야 한다.
- 녹음 종료하고 회의록 생성 요청 또는 마지막 참여자 나가기 자동 종료 시 진행 중 녹음이 있으면 녹음을 종료한다.
- 녹음 종료는 회의방 종료가 아니다.
- 녹음 종료 후에도 `Meeting.endedAt = null`이면 기존 참여자와 새 사용자가 계속 참여할 수 있다.
- 녹음 파일 URL 또는 object key를 저장한다.
- 녹음 실패 시 실패 상태와 원인을 저장한다.
- `recording.durationSec`이 60 이하면 회의록을 생성하지 않는다. 단, 녹음 자체가 실패해 duration을 알 수 없는 경우에는 실패한 회의록을 남길 수 있다.

### 7.9 회의 나가기와 녹음 종료

회의 나가기:

- 현재 사용자만 LiveKit Room에서 나간다.
- 서버는 현재 사용자의 `meeting_participants.leftAt`을 저장한다.
- 남은 참여자가 있으면 회의는 계속 진행된다.
- 마지막 참여자가 나가면 서버가 회의를 자동 종료한다.
- 마지막 참여자가 나갈 때 진행 중 녹음이 있으면 서버가 녹음을 종료하고 회의록 생성을 트리거한다.

녹음 시작:

- 회의에 참여 중인 사용자라면 누구나 실행할 수 있다.
- 회의에 참여하지 않은 사용자가 요청을 보내면 `403 FORBIDDEN`을 반환한다.
- 서버는 같은 Meeting에 진행 중 녹음이 있는지 lock으로 확인한다.
- 진행 중 녹음이 있으면 기존 Recording을 반환하고 LiveKit Egress 시작 side effect를 다시 수행하지 않는다.
- 진행 중 녹음이 없으면 LiveKit Egress를 시작하고 `meeting_recordings.status = RUNNING`으로 저장한다.
- LiveKit Egress 시작에 실패하면 성공하지 않은 녹음을 `RUNNING`으로 남기지 않는다.

녹음 종료하고 회의록 생성:

- 녹음만 종료하고 회의방은 계속 유지한다.
- 회의에 참여 중인 사용자라면 누구나 실행할 수 있다.
- 회의에 참여하지 않은 사용자가 요청을 보내면 `403 FORBIDDEN`을 반환한다.
- 이 요청은 `Meeting.endedAt`을 저장하지 않는다.
- `Meeting.endedAt = null`이면 녹음 종료 후에도 기존 참여자와 새 사용자가 계속 참여할 수 있다.
- 서버는 target Recording row를 lock으로 잡고 `RUNNING`인지 확인한다.
- 이미 종료된 녹음이면 기존 Recording과 MeetingReport 결과를 반환한다.
- 서버는 회의 나가기, 녹음 종료, 회의록 생성 트리거가 중복 실행되지 않도록 처리한다.

중복 종료 방지:

```ts
if (recording.status !== "RUNNING") {
  return existingResult;
}
```

### 7.10 회의록 생성

기준:

```ts
const REPORT_MIN_DURATION_SECONDS = 60;
```

규칙:

- `recording.durationSec`이 60 이하면 MeetingReport를 생성하지 않는다.
- `recording.durationSec`이 60 이하인 녹음은 회의록 목록에도 노출하지 않는다.
- `recording.durationSec`이 60을 초과하면 MeetingReport를 `PROCESSING` 상태로 생성한다.
- App Server는 MeetingReport를 `PROCESSING`으로 생성하고 AI job을 enqueue한다.
- MVP에서는 `PROCESSING`을 queued와 running을 모두 포함하는 상태로 사용한다.
- AI Worker는 job을 consume해 녹음 파일을 OpenAI STT API에 전달하고 transcript를 만든다.
- AI Worker는 transcript를 OpenAI LLM API에 전달해 회의록을 생성한다.
- AI Worker는 생성된 보고서를 DB에 저장하고 MeetingReport를 `COMPLETED` 또는 `FAILED`로 갱신한다.
- Frontend는 App Server API로 MeetingReport 상태를 조회한다. 화면과 API 조회의 source of truth는 DB의 MeetingReport다.

회의록 상태:

```ts
type MeetingReportStatus = "PROCESSING" | "COMPLETED" | "FAILED";
```

실패 기록:

- `failedStep`: `STT`, `LLM`, `RECORDING`
- `errorMessage`
- `retryCount`

재시도:

- `FAILED` 상태에서만 재시도 가능하다.
- `PROCESSING`, `COMPLETED` 상태에서는 재시도할 수 없다.

## 8. 자유형 캔버스

### 8.1 목적

PILO 캔버스는 사용자가 Workspace 안에서 자유롭게 도형을 배치하고, 직접 편집하고, 나중에 다시 들어와도 같은 상태를 이어서 볼 수 있는 자유형 캔버스다.

### 8.2 데이터 소유 범위

캔버스가 직접 관리하는 데이터:

- 캔버스 기본 정보
- 줌과 화면 위치
- 캔버스 위 자유 도형
- 사용자 입장/퇴장 상태

캔버스가 직접 소유하거나 변경하지 않는 데이터:

- GitHub repository, issue, PR
- PR 리뷰 세션, 리뷰 파일, 리뷰 결정
- 회의, 녹음, 회의록
- 일정
- 계정과 권한
- 에이전트 워크플로우

### 8.3 핵심 사용자 흐름

1. 사용자가 캔버스 페이지에 들어온다.
2. 클라이언트가 현재 Workspace ID를 확인한다.
3. 해당 Workspace의 캔버스 목록을 조회한다.
4. 첫 번째 캔버스 또는 선택된 캔버스를 연다.
5. 캔버스 상세 정보를 조회한다.
6. 저장된 자유 도형을 화면에 렌더링한다.
7. 마지막 저장된 줌과 화면 위치를 복원한다.
8. 캔버스 입장 API를 호출한다.
9. 사용자가 캔버스를 편집한다.
10. 도형 변경사항과 화면 위치 변경사항을 저장한다.
11. 사용자가 다른 페이지로 이동하거나 탭을 닫는다.
12. 캔버스 퇴장 API를 호출한다.

### 8.4 데이터 모델

`canvas`:

- `id`
- `workspace_id`
- `title`
- `board_type`: MVP 값은 `freeform`, `review`
- `zoom`
- `viewport_x`
- `viewport_y`
- `created_by`
- `created_at`
- `updated_at`

`canvas_freeform_shapes`:

- `id`
- `canvas_id`
- `shape_type`
- `title`
- `text_content`
- `x`
- `y`
- `width`
- `height`
- `rotation`
- `z_index`
- `raw_shape`
- `created_at`
- `updated_at`
- `deleted_at`

`canvas_user_states`:

- `id`
- `canvas_id`
- `user_id`
- `entered_at`
- `left_at`

### 8.5 지원 도형

MVP 지원 shape type:

- `sticky-note`
- `text`
- `frame`
- `draw`
- `highlight`
- `geo`
- `arrow`
- `line`
- `image`
- `video`
- `bookmark`
- `embed`
- `group`
- `pilo-sticky-note`
- `pilo-code-block`
- `file_node`

규칙:

- 캔버스 위 모든 객체는 자유 도형으로 저장한다.
- 화살표/연결선은 `shape_type = arrow`로 저장한다.
- 일반 선은 `shape_type = line`으로 저장한다.
- 별도 연결선 테이블은 MVP에서 두지 않는다.
- 화면 복원의 기준은 `raw_shape`다.
- `title`, `text_content`는 검색과 추출을 위한 보조 컬럼이다.

### 8.6 UI 요구사항

레이아웃:

- 왼쪽 네비게이션 또는 사이드바
- 왼쪽 세로 도구 바
- 전체 화면 기반 편집 캔버스 영역
- 하단 또는 우측 하단 줌 컨트롤

도구 바:

- 선택
- 프레임
- 스티키 메모
- 코드블럭
- 텍스트
- 화살표/연결선
- 그리기
- 도형
- 삽입
- 화면 맞춤
- 실행 취소
- 다시 실행

줌 컨트롤:

- 화면 맞춤
- 축소
- 현재 줌 퍼센트 표시
- 확대

### 8.7 저장과 입장/퇴장

도형 생성:

- 프론트에서 도형 ID를 생성한다.
- 캔버스 엔진에 도형을 만든다.
- 저장용 필드를 추출한다.
- 도형 생성 API 또는 배치 저장 API로 저장한다.
- 이미지와 비디오는 MVP에서 작은 로컬 파일만 지원한다.
- 큰 이미지/비디오는 저장하지 않고 파일 크기 제한 안내를 표시한다.
- 작은 파일의 실제 제한값은 구현 상수로 관리한다.

도형 수정:

- 화면에서는 즉시 변경한다.
- 저장은 debounce 처리한다.
- 최신 도형 상태와 `rawShape`를 저장한다.

도형 삭제:

- 화면에서 즉시 제거한다.
- 서버는 `deleted_at`을 저장한다.
- 일반 캔버스 상세 조회에서는 삭제된 도형을 제외한다.

화면 위치 변경:

- 화면 카메라를 즉시 변경한다.
- 저장을 debounce 처리한다.
- `zoom`, `viewportX`, `viewportY`를 저장한다.
- 재입장 시 해당 값을 복원한다.

입장/퇴장:

- 캔버스가 열리면 입장 API를 호출한다.
- 다른 페이지 이동, 탭 닫기, 새로고침, 로그아웃, 컴포넌트 unmount 시 퇴장 API를 호출한다.
- MVP에서는 하트비트를 사용하지 않는다.

### 8.8 에러 처리

- 캔버스 API가 실패해도 UI 전체가 깨지면 안 된다.
- 사용자의 화면 편집은 즉시 반응해야 한다.
- 저장 실패 상태를 사용자에게 알려야 한다.
- 저장 실패 시 재시도할 수 있어야 한다.

최소 UI 상태:

- 로딩 중
- 준비됨
- 저장 실패

## 9. 캘린더 일정

### 9.1 목적

캘린더는 로그인한 사용자가 월간 화면에서 Workspace 일정을 확인하고, 일정의 생성/수정/삭제와 상세 조회를 수행하는 기능이다.

MVP에서 캘린더에 표시하는 항목은 `일정`만이다.

### 9.2 기본 화면

기능:

| 기능 | 상세 |
| --- | --- |
| 기본 뷰 | 로그인 직후 메인페이지에서 현재 월 달력을 표시한다. |
| 월 이동 | 이전 달/다음 달 버튼으로 표시 월을 변경한다. |
| 현재 월 이동 | 월/년 표시 영역을 더블 클릭하면 오늘이 포함된 년/월로 이동한다. |
| 날짜 셀 표시 | 각 날짜 셀에는 해당 날짜에 포함되는 일정 제목만 표시한다. |
| 긴 제목 처리 | 제목이 길 경우 한 줄 말줄임 처리한다. |
| 다건 표시 | 하루 항목이 많으면 3개까지만 표시하고 초과분은 `+N`으로 표시한다. |
| 오늘 표시 | 오늘 날짜는 다른 날짜와 구분되도록 표시한다. |
| 선택 날짜 표시 | 사용자가 클릭한 날짜는 선택 상태로 표시한다. |

통합 결정:

- 한 날짜 셀의 표시 개수는 MVP에서 고정 3개로 한다.
- 화면 크기별 동적 개수 조정은 추후 개선으로 둔다.

### 9.3 월 달력 레이아웃

규칙:

- 주 시작 요일은 일요일로 한다.
- 이전/다음 달 날짜를 흐리게 표시한다.
- 이전/다음 달 날짜도 클릭 가능하다.
- 이전/다음 달 날짜를 클릭하면 해당 날짜가 선택 상태가 된다.
- 이전/다음 달 날짜 셀에도 해당 날짜의 일정을 표시한다.

### 9.4 일정 표시 기준

| 타입 | 표시 기준 |
| --- | --- |
| 단일 일정 | 시작일에 표시한다. |
| 여러 날 일정 | 시작일과 종료일을 포함해 모든 날짜에 표시한다. |
| 월을 걸치는 일정 | 현재 달력 화면에 포함되는 날짜만 표시한다. |

정렬:

- 여러 일정이 있을 때 종일 일정이 우선이다.
- 시간 지정 일정은 시작 시간이 빠른 순으로 정렬한다.
- 보조 정렬은 생성일이 빠른 순서다.
- 종일 일정끼리는 생성일이 빠른 순서로 정렬한다.

### 9.5 우측 날짜 패널

동작:

- 날짜 셀의 `+N`을 클릭하면 우측 패널을 연다.
- 우측 패널에는 해당 날짜의 전체 일정 목록을 표시한다.
- 우측 패널의 일정 항목을 클릭하면 일정 상세 모달을 연다.

### 9.6 상세 모달

캘린더에 표시된 일정 제목을 클릭하면 상세 모달을 표시한다.

표시 정보:

| 항목 | 상세 |
| --- | --- |
| 제목 | 일정 제목 |
| 시간 정보 | 시작 날짜/시간, 종료 날짜/시간 |
| 등록한 사람 | 해당 일정을 등록한 사용자 |
| 본문/상세 내용 | 일정 상세 설명 |
| 생성일/수정일 | 생성 시간과 마지막 수정 시간 |
| 색상 | 캘린더에 표시되는 일정 색상 |
| 종일 여부 | 시간이 지정되지 않은 종일 일정인지 표시 |

모달 액션:

| 액션 | 상세 |
| --- | --- |
| 수정 | 일정 정보를 수정한다. |
| 삭제 | 삭제 확인 모달을 연다. |

권한 정책:

- MVP에서는 Workspace에 접근 가능한 모든 사용자가 모든 일정을 생성, 수정, 삭제할 수 있다.
- `등록한 사람`은 표시와 감사 목적의 데이터이며, 수정/삭제 권한을 제한하는 소유자 조건으로 사용하지 않는다.

### 9.7 일정 생성

입력값:

- 제목
- 색상
- 본문/상세 내용
- 시작 날짜/시간
- 종료 날짜/시간
- 종일 여부

생성 규칙:

- 색상은 hex color로 선택한다.
- 상단 `+ 일정` 버튼으로 생성한다.
- 생성 모달의 시작 날짜는 선택 날짜로 설정한다.
- 제목은 필수 입력값이다.
- 종일 여부는 체크박스로 선택한다.
- 시작 날짜를 입력하지 않으면 오늘 날짜로 설정한다.
- 종료 날짜를 입력하지 않으면 시작 날짜와 동일하게 설정한다.
- 종일 일정인 경우 시작 날짜만 필수다.
- 종일 일정이 여러 날에 걸칠 때만 종료 날짜를 입력한다.
- 종일 일정인 경우 시간 입력 필드를 숨기거나 비활성화한다.
- 종일 체크를 해제하면 시간 입력 필드를 표시한다.
- 시간 지정 일정은 시작 시간이 필수다.
- 시간 지정 일정에서 종료 시간을 입력하지 않으면 시작 시간으로부터 1시간 뒤로 자동 설정한다.
- 종료 일시는 시작 일시보다 이후여야 한다.
- 등록한 사람은 로그인한 사용자 정보로 자동 저장한다.

### 9.8 일정 수정

수정 가능 항목:

- 제목
- 색상
- 본문/상세 내용
- 시작 날짜/시간
- 종료 날짜/시간
- 종일 여부

수정 규칙:

- 캘린더 안에서는 전체 수정 가능하다.
- 작성자와 무관하게 Workspace 접근 권한이 있는 사용자는 일정을 수정할 수 있다.
- 종일에서 시간 지정 일정으로 변경하면 시작 시간을 입력해야 한다.
- 시간 지정 일정으로 변경했는데 종료 시간을 입력하지 않으면 시작 시간으로부터 1시간 뒤로 자동 설정한다.
- 시간 지정 일정에서 종일 일정으로 변경하면 시간 정보는 제거하고 날짜만 유지한다.

### 9.9 일정 삭제

규칙:

- 삭제 버튼 클릭 시 확인 모달을 표시한다.
- 작성자와 무관하게 Workspace 접근 권한이 있는 사용자는 일정을 삭제할 수 있다.
- 사용자가 확인하면 일정을 삭제한다.
- 사용자가 취소하면 삭제하지 않고 상세 모달로 돌아간다.

## 10. sqltoerd

### 10.1 목적

sqltoerd는 사용자가 Workspace 안에서 PostgreSQL/MySQL DDL을 입력하면 table card와
FK relation line으로 구성된 ERD를 확인하고, 마지막 상태를 Workspace session으로
저장/복원하는 기능이다.

MVP는 읽기 중심 ERD 확인과 Workspace 저장 안정화를 목표로 한다.

### 10.2 기본 화면

sqltoerd 화면은 PILO 기본 app shell 안에서 동작한다.

```text
PILO Sidebar | Left Source Panel | Center ERD Canvas | Right Inspector Panel
```

기능:

| 영역 | 상세 |
| --- | --- |
| PILO Sidebar | 기존 Workspace navigation을 유지한다. |
| Left Source Panel | SQL editor, dialect selector, Generate 버튼, parse/save 상태를 표시한다. |
| Center ERD Canvas | tldraw surface 위에 table card와 FK relation line을 표시한다. |
| Right Inspector Panel | 선택한 table, column, relation의 상세 정보를 읽기 전용으로 표시한다. |

### 10.3 입력과 파싱

- MVP source format은 `sql`만 지원한다.
- MVP dialect는 `auto`, `postgresql`, `mysql`을 지원한다.
- 사용자는 Source Panel에 SQL DDL을 입력한다.
- Generate 실행 시 client가 SQL DDL을 parsing하고 ERD semantic model을 만든다.
- app-server는 SQL을 실행하거나 parsing하지 않는다.
- parsing 실패 시 Source Panel에 error 상태를 표시하고 기존 session을 덮어쓰지 않는다.

### 10.4 ERD 표시

MVP에서 표시하는 ERD object:

- table card
- column row
- PK/FK/unique/not-null 표시
- FK relation line

상호작용:

- 사용자는 table card를 drag할 수 있다.
- 사용자는 canvas를 zoom/pan할 수 있다.
- 사용자는 table, column, relation을 선택할 수 있다.
- 선택한 항목의 상세 정보는 Inspector에 표시한다.

MVP Inspector는 읽기 전용이다. table/column inline edit과 Add column은 제외한다.

### 10.5 Workspace session 저장

MVP에서는 active Workspace당 활성 sqltoerd session 1개만 지원한다.

저장 대상:

- source text
- source format
- SQL dialect
- ERD semantic model
- table layout
- table count
- relation count
- revision

저장 규칙:

- 첫 Generate 성공 시 Workspace session을 생성한다.
- Generate 성공, table 위치 변경 등 저장 대상이 바뀌면 자동 저장한다.
- 자동 저장은 revision 기반 conflict 감지를 사용한다.
- 새로고침하면 저장된 Workspace session을 복원한다.
- SQL 원문은 plain text로만 저장하고 실행하지 않는다.

## 11. 데이터 소유권과 모듈 경계

| 모듈 | 소유 데이터 | 다른 모듈과의 관계 |
| --- | --- | --- |
| 인증/사용자 | users, login session, GitHub OAuth 연결 | 등록자, 리뷰 제출자, 회의 참여자, 캔버스 입장자 식별에 사용 |
| Workspace | workspace, membership, role | 모든 데이터의 tenant 경계 |
| GitHub 연동 | installations, repositories, issues, pull_requests, projects_v2, sync_runs | 칸반과 PR 리뷰에 원본 데이터를 제공 |
| Kanban | boards, board_columns, pilo_issues, pending moves | GitHub ProjectV2 상태를 로컬 보드로 표현 |
| PR 리뷰 | review_sessions, review_flows, review_files, file_review_decisions, review_submissions | GitHub PR 데이터와 사용자 OAuth token을 사용 |
| 회의 | meetings, participants, recordings, meeting_reports | 사용자 정보만 참조 |
| 자유형 캔버스 | canvas, canvas_freeform_shapes, canvas_user_states | 다른 도메인 데이터를 직접 변경하지 않음 |
| 캘린더 | schedules/events | 등록자 사용자 정보만 참조 |
| sqltoerd | sql_erd_sessions, source text, ERD model, layout, revision | Workspace 접근 경계를 사용하며 자유형 Canvas shape 저장소를 직접 사용하지 않음 |

## 12. 통합 결정 사항

### 12.1 칸반 AI와 PR 리뷰 AI

- 칸반보드의 AI agent 추천, 자동 작업 생성, 자동 리뷰는 MVP에서 제외한다.
- PR 리뷰의 AI 분석은 MVP에 포함한다.
- 따라서 `AI 제외`는 칸반 자동화에만 적용하고, PR 리뷰 분석에는 적용하지 않는다.

### 12.2 파일별 리뷰 상태

원문에 `change_requested` 상태가 등장하지만, PR 리뷰 화면 명세는 파일별 상태를 3개로 제한한다.

통합 MVP 파일 상태:

- `not_reviewed`
- `approved`
- `discussion_needed`
- `unknown`

`REQUEST_CHANGES`는 파일별 상태가 아니라 GitHub Review 제출 타입으로만 사용한다.

### 12.3 GitHub Issue 수정

Kanban 문서에는 상세 form 수정 흐름이 포함되어 있으나, GitHub 연동 문서는 GitHub issue 생성/수정 API를 MVP 제외로 둔다.

통합 MVP 결정:

- 이슈 상세 패널은 조회 중심이다.
- 보드 lane/status 이동은 지원한다.
- 이슈 제목, 본문, assignee, label, milestone, due date 직접 수정은 MVP 제외다.

### 12.4 PR 리뷰 세션 삭제 정책

PR 리뷰 기능은 MVP에서 리뷰 화면 단위 임시 세션을 사용한다.

통합 MVP 결정:

- Review Session은 PR 리뷰 화면에 머무는 동안만 유지한다.
- 사용자가 PR 리뷰 화면을 나가면 `DELETE /review-sessions/{reviewSessionId}`를 호출해 세션을 삭제한다.
- 세션 삭제 시 `review_flows`, `review_files`, `review_flow_files`, `file_review_decisions`, `review_submissions`는 DB FK cascade로 함께 삭제된다.
- `review_submissions`는 화면 안에서 제출 결과와 실패 원인을 확인하기 위한 세션 내부 이력이다.
- GitHub에 이미 제출된 Review 자체는 GitHub에 남지만, MVP에서는 해당 제출 이력을 PILO DB에 장기 보존하지 않는다.

### 12.5 자유형 캔버스와 PR 리뷰 캔버스

- 자유형 캔버스는 사용자가 직접 편집하는 도형 보드다.
- PR 리뷰 캔버스는 AI가 생성한 Flow/Node/Edge를 보여주는 리뷰 화면이다.
- 자유형 캔버스는 PR 리뷰를 실행하지 않는다.
- PR 리뷰 캔버스의 파일 Node는 리뷰 도메인 데이터이며, 자유형 캔버스 도형 저장 정책과 분리한다.

### 12.6 캘린더 셀 표시 개수

통합 MVP에서는 날짜 셀당 일정 제목을 최대 3개 표시한다.

초과 일정은 `+N`으로 표시하고, 클릭 시 우측 날짜 패널에서 전체 목록을 보여준다.

### 12.7 PR 필드와 변경 파일 조회

통합 MVP에서는 PR 부가 필드를 별도 컬럼으로 추가하지 않고 `github_pull_requests.raw` JSONB에서 파생한다.

PR 변경 파일은 GitHub Integration의 별도 원본 캐시 테이블에 저장하지 않고 매번 GitHub API에서 조회한다. 단, 리뷰 세션 생성 시 변경 파일 metadata는 `review_files`에 저장한다. MVP 사용 중 실제 속도를 측정한 뒤, 필요하면 GitHub 원본 PR file cache 테이블을 별도 개선 항목으로 도입한다.

### 12.8 Webhook Delivery 저장

Webhook delivery id는 activity log metadata가 아니라 별도 테이블에 저장한다.

이 테이블은 중복 webhook 수신 방지와 재처리 이력 확인에 사용한다.

### 12.9 캘린더 수정 권한

MVP에서는 Workspace 접근 권한이 있는 모든 사용자가 모든 일정을 생성, 수정, 삭제할 수 있다.

작성자 제한, 관리자 승인, 일정별 권한은 MVP 이후 확장으로 둔다.

### 12.10 sqltoerd 저장 경계

sqltoerd는 tldraw surface를 사용하지만 자유형 Canvas의 저장 API나
`canvas_freeform_shapes`를 재사용하지 않는다.

통합 MVP 결정:

- sqltoerd 저장소는 `sql_erd_sessions`다.
- MVP에서는 active Workspace당 활성 sqltoerd session 1개만 지원한다.
- SQL 원문은 plain text로만 저장하고 실행하지 않는다.
- app-server는 SQL parsing과 auto layout을 수행하지 않는다.

## 13. MVP 수용 기준

### 13.1 GitHub 연결

- 사용자는 Workspace에 GitHub App을 설치할 수 있다.
- signed state 검증 실패 시 installation이 저장되지 않는다.
- full sync 후 repository, issue, PR, ProjectV2, field, option, item이 저장된다.
- sync run은 `running`, `success`, `failed` 상태와 count를 기록한다.
- GitHub OAuth token은 암호화 저장되며 응답과 로그에 노출되지 않는다.

### 13.2 Kanban

- 사용자는 연결된 GitHub Project를 칸반보드로 볼 수 있다.
- 카드에는 이슈 번호와 제목만 기본 노출된다.
- 사용자는 검색과 필터로 원하는 이슈를 찾을 수 있다.
- 사용자는 카드를 클릭해 상세 패널을 열 수 있다.
- 상세 패널에서 PR 상태와 CI 상태를 확인할 수 있다.
- 사용자는 이슈를 같은 보드의 다른 lane으로 이동할 수 있다.
- 이동 실패 시 보드가 잘못된 상태로 남지 않는다.
- 권한 없는 사용자는 private repo 데이터를 볼 수 없다.
- read-only 사용자는 수정 기능이 비활성화된다.
- 모바일에서 보드와 상세 패널을 사용할 수 있다.

### 13.3 PR 리뷰

- GitHub Repository가 연결되어 있으면 open PR 목록만 표시된다.
- PR 목록은 10개 단위로 페이지 이동할 수 있다.
- PR 번호 또는 제목으로 검색할 수 있다.
- PR을 클릭하면 상세 모달이 열린다.
- 리뷰 시작 클릭 전에는 AI 분석이 생성되지 않는다.
- 리뷰 시작 후 분석 성공 시 PR 리뷰 캔버스로 이동한다.
- 분석된 Flow/Node/Edge가 캔버스에 표시된다.
- 파일 Node 클릭 시 해당 파일 리뷰창으로 이동한다.
- 일반 텍스트 파일은 side-by-side diff로 표시된다.
- binary 파일은 미리보기 생략 안내와 GitHub에서 보기 버튼을 표시한다.
- large diff 파일은 미리보기 생략 안내와 GitHub에서 보기 버튼을 표시한다.
- 파일별 리뷰 판단 버튼은 `문제 없음`, `논의/수정 필요`, `판단 불가` 3개만 보인다.
- 파일별 comment는 저장되고 제출 모달의 reviewBody에 포함된다.
- 모든 파일의 reviewStatus가 선택되면 Review 제출 버튼이 활성화된다.
- 제출 모달에서 사용자가 `COMMENT`, `APPROVE`, `REQUEST_CHANGES` 중 하나를 직접 선택한다.
- GitHub Review 제출 시 line comment는 생성되지 않는다.
- Merge 버튼은 보이지만 실제 merge는 수행하지 않는다.
- conflict 상태는 `확인 중`, `충돌 없음`, `충돌 있음`, `충돌 확인 실패` 중 하나로 표시된다.

### 13.4 회의와 회의록

- 사용자는 회의 페이지에서 진행 중 회의 여부를 확인할 수 있다.
- 사용자는 단일 `회의 참여하기` 버튼으로 진행 중 회의에 참여하거나 새 Meeting을 시작할 수 있다.
- 같은 `workspaceId + roomKey`에서 진행 중 Meeting은 하나만 존재한다.
- 첫 이용자는 녹음 동의 모달을 봐야 하며, 동의하지 않으면 참여할 수 없다.
- 마이크 권한 거부 시 회의 참여 불가 안내를 본다.
- 사용자는 LiveKit Room에서 음성 회의를 할 수 있다.
- 회의 시작 또는 참여만으로 녹음이 자동 시작되지 않는다.
- 참여자는 `녹음 시작` 버튼으로 녹음을 시작할 수 있다.
- 같은 Meeting 안에서 진행 중 녹음은 하나만 존재한다.
- 회의 중 녹음 상태가 보인다.
- 마지막 참여자가 나가면 회의가 자동 종료된다.
- 참여자는 녹음 종료하고 회의록 생성을 요청할 수 있다.
- 녹음 종료하고 회의록 생성은 회의방을 종료하지 않는다.
- `Meeting.endedAt = null`이면 녹음 종료 후에도 기존 참여자와 새 사용자가 계속 참여할 수 있다.
- 하나의 Meeting에는 여러 Recording과 MeetingReport가 연결될 수 있다.
- `recording.durationSec`이 60 이하면 MeetingReport를 생성하지 않고 목록에도 표시하지 않는다.
- `recording.durationSec`이 60을 초과하면 STT/LLM 처리를 통해 MeetingReport를 생성한다.
- 실패한 MeetingReport는 실패 사유와 재시도 버튼을 제공한다.

### 13.5 자유형 캔버스

- 사용자가 Workspace 캔버스를 열 수 있다.
- 사용자가 자유 도형을 생성할 수 있다.
- 사용자가 도형을 이동, 크기 변경, 수정, 삭제할 수 있다.
- 사용자가 화면을 이동하고 확대/축소할 수 있다.
- 사용자가 나갔다가 다시 들어와도 같은 화면 상태를 볼 수 있다.
- 도형 데이터가 `rawShape`와 함께 저장된다.
- 화면 상태가 `zoom`, `viewportX`, `viewportY`로 저장된다.
- 캔버스를 열 때 입장 API가 호출된다.
- 캔버스를 나갈 때 퇴장 API가 호출된다.
- MVP에서는 하트비트가 없어도 된다.

### 13.6 캘린더

- 로그인 직후 메인페이지에서 현재 월 달력을 볼 수 있다.
- 사용자는 이전 달/다음 달로 이동할 수 있다.
- 월/년 표시 영역을 더블 클릭하면 오늘이 포함된 월로 이동한다.
- 오늘 날짜와 선택 날짜는 구분되어 표시된다.
- 이전/다음 달 날짜는 흐리게 보이지만 클릭 가능하다.
- 날짜 셀에는 해당 날짜의 일정 제목만 표시된다.
- 한 날짜에 일정이 3개를 초과하면 `+N`으로 표시된다.
- `+N` 클릭 시 우측 패널에 전체 일정이 표시된다.
- 일정 제목 또는 우측 패널 항목 클릭 시 상세 모달이 열린다.
- Workspace 접근 권한이 있는 사용자는 모든 일정을 생성, 수정, 삭제할 수 있다.
- 종일 일정과 시간 지정 일정 입력 규칙이 올바르게 적용된다.
- 여러 날 일정은 시작일과 종료일을 포함한 모든 날짜에 표시된다.

### 13.7 sqltoerd

- 사용자는 PostgreSQL 또는 MySQL DDL을 Source Panel에 입력할 수 있다.
- Generate 성공 시 table card가 생성된다.
- PK/FK/unique/not-null 정보가 table card에 표시된다.
- FK relation line이 표시된다.
- 사용자는 table card를 drag할 수 있다.
- 사용자는 canvas를 zoom/pan할 수 있다.
- 사용자는 table, column, relation을 선택할 수 있다.
- Inspector는 선택한 항목의 정보를 읽기 전용으로 표시한다.
- 첫 Generate 성공 후 Workspace session이 생성된다.
- Generate 성공과 table drag 이후 session이 자동 저장된다.
- 새로고침하면 저장된 Workspace session이 복원된다.
- revision conflict가 발생하면 자동 저장을 멈추고 conflict 상태를 표시한다.
- parsing 실패 시 사용자에게 error 상태를 표시한다.
- SQL은 실행되지 않는다.

## 14. 테스트 계획

| 레이어 | 테스트 대상 | 주요 검증 |
| --- | --- | --- |
| Unit | OAuth/App state | 생성, 만료, 위변조 검증 |
| Unit | permission guard | Workspace 접근 권한 검증 |
| Unit | sync status | sync run 상태 전이와 count 기록 |
| Unit | board position | column/issue position 충돌 처리 |
| Unit | PR review status | 파일 상태, 진행률, 제출 가능 상태 |
| Unit | calendar schedule rules | 종일/시간 지정/여러 날 일정 계산 |
| Unit | meeting duplicate guard | active meeting, active recording, recording/report side effect 중복 방지 |
| Unit | sqltoerd parser/model | PostgreSQL/MySQL DDL, PK/FK/unique/not-null, ERD model 생성 |
| Unit | sqltoerd validation | source/model/layout 제한값, revision conflict |
| Integration | GitHub App callback | installation 저장 및 중복 callback 처리 |
| Integration | sync run | GitHub API mock 기반 upsert |
| Integration | board hydrate | ProjectV2 field/option/item에서 board 생성 |
| Integration | kanban move | lane 이동, GitHub sync 성공/실패 처리 |
| Integration | PR review | PR 조회, 분석 세션, 파일 결정, submission |
| Integration | webhook | signature 검증 및 이벤트 반영 |
| Integration | meeting report | 녹음 시작, 녹음 종료, recording, STT, LLM, retry |
| Integration | canvas persistence | 도형 CRUD와 viewport 복원 |
| Integration | sqltoerd session | session 생성, 조회, autosave, soft delete, Workspace 접근 검증 |
| E2E | 최초 연결 | GitHub App 설치, full sync, 보드 표시 |
| E2E | 칸반 | 검색, 필터, 상세, lane 이동 |
| E2E | PR 리뷰 | PR 선택, 리뷰 시작, diff 확인, GitHub 제출 |
| E2E | 회의 | 회의 시작, 참여, 나가기, 녹음 시작, 녹음 종료, 회의록 생성 |
| E2E | 캘린더 | 일정 생성, 월간 표시, 상세, 수정, 삭제 |
| E2E | sqltoerd | SQL 입력, ERD 생성, table 선택, 저장/복원 |

## 15. 구현 전 확정 사항 반영

팀 확인 결과, 기존 미정 항목은 다음과 같이 정리한다.

| 항목 | 결정 |
| --- | --- |
| Workspace 역할 모델 | 이번 스프린트에서 확정하지 않고 바로 다음 스프린트에서 다룬다. 현재 문서는 Workspace 경계를 전제로만 유지한다. |
| PR 필드 저장 방식 | `state`, `draft`, `mergeable`, `head_sha`, `base_sha`는 별도 컬럼을 추가하지 않고 `raw` JSONB에서 파생한다. |
| Webhook delivery id 저장 위치 | 별도 테이블에 저장한다. activity log metadata만으로 처리하지 않는다. |
| PR 변경 파일 캐시 | GitHub Integration 원본 캐시는 두지 않고 매번 GitHub API에서 가져온다. 리뷰 세션의 파일 metadata는 `review_files`에 저장한다. 실제 속도를 확인한 뒤 필요 시 원본 캐시 테이블을 재검토한다. |
| 캘린더 권한 | Workspace 접근 권한이 있는 모든 사용자가 모든 일정을 생성, 수정, 삭제할 수 있다. |
| 자유형 캔버스 이미지/비디오 저장 | MVP에서는 작은 이미지/비디오 파일만 지원한다. 큰 파일 저장과 별도 파일 저장소 연동은 제외한다. |
| sqltoerd MVP 범위 | PostgreSQL/MySQL DDL 기반 ERD 생성, table card, FK relation line, Inspector, Workspace session 저장/복원까지만 포함한다. |

남은 이월 항목:

- Workspace 역할과 멤버십 모델은 다음 스프린트에서 별도 기능명세로 확정한다.
- GitHub Integration 원본 PR 변경 파일 캐시 여부는 성능 측정 후 결정한다.
