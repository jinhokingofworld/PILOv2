# GitHub 설정 화면 재구성 설계

- 관련 Issue: #1507
- 대상 도메인: GitHub Integration
- 연관 도메인: Settings, Board
- 기준 브랜치: `dev`

## 목적

GitHub 설정 탭을 PILO의 다른 설정 탭과 같은 단일 열 설정 화면으로 재구성한다.
설정에서 불필요한 Pull Request 목록을 제거하고, 사용자가 GitHub 연결 의존성,
repository 선택, 활성 Board 선택, 수동 동기화 작업을 짧고 명확하게 이해하도록 한다.

## 범위

### 포함

- GitHub 계정, GitHub App, Project 작업 권한의 순차 활성화
- repository 선택 영역의 문구와 시각 구조 개선
- 활성 Board 변경용 Project v2 선택 모달
- Project v2와 수동 동기화 섹션 분리
- GitHub 설정의 Pull Request 목록과 해당 화면 전용 조회 상태 제거
- 실제 데이터 기반 로딩, 빈 상태, 성공, 오류 표시
- GitHub Integration 도메인 아래 검증 추가

### 제외

- Pull Request API, 타입, 서버 동기화 제거
- Home의 Pull Request 목록과 PR Review 기능 변경
- GitHub OAuth, GitHub App, Project OAuth 인증 계약 변경
- Board API 또는 활성 Board 전환 계약 변경
- DB schema 또는 migration 변경
- shadcn/ui primitive와 frontend 공통영역 변경

## 정보 구조

GitHub 설정 본문은 다른 설정 탭과 같은 최대 폭과 수직 흐름을 사용한다. 큰 hero나
별도 대시보드 shell을 만들지 않고 다음 네 섹션을 한 열로 배치한다.

1. 연결
2. 저장소
3. Project v2
4. 동기화

각 섹션은 흰 배경, 얕은 그림자, 8~10px 수준의 절제된 radius를 사용한다. 섹션 안에서는
카드를 다시 중첩하지 않고 행, 구분선, 간단한 목록으로 계층을 표현한다. 연결, repository,
동기화를 암시하는 저대비 배경 도형은 섹션 가장자리에만 두며 실제 컨트롤보다 눈에 띄지 않게 한다.

## 연결 단계

연결 섹션은 세 단계를 같은 카드 안의 행으로 표시한다.

### 1. GitHub 계정 연결

- 최초 활성 단계다.
- GitHub App 설치 확인, PR Review, 기존 Issue 수정에 쓰이는 `app_user` 연결이다.
- 미연결이면 2단계와 3단계의 실행 버튼을 비활성화한다.

### 2. GitHub App 설치

- 1단계 완료 후 활성화한다.
- Workspace에서 사용할 repository와 Organization Project 조회·동기화 기반이다.
- 설치 완료 전에는 repository 선택과 3단계 실행 버튼을 비활성화한다.
- 설치 callback의 기존 `source` 동기화 동작은 유지한다.

### 3. Project 작업 권한

- 2단계 완료 후 활성화한다.
- 단순 조회 사용자에게는 선택 사항이지만, PILO에서 Project 카드 이동 또는 새 Issue 생성 시 필수다.
- `project_v2` 연결의 `project`와 `repo` scope 요구사항을 짧게 안내한다.
- 연결하지 않아도 repository, Issue, Pull Request와 Organization Project 읽기·동기화는 유지한다.

각 단계는 `연결됨`, `설치됨`, `보드 편집 시 필요`, `선행 단계 필요`처럼 실제 상태와 다음 행동을
함께 표시한다. 선행 단계가 없을 때 실행 버튼은 disabled 상태이며 이유를 버튼 또는 보조 문구로 제공한다.

## 저장소

저장소 섹션은 “Board 소스”라는 표현 대신 “Project를 조회하고 동기화할 repository를 선택한다”고
설명한다. 기존 검색, 페이지네이션, 외부 GitHub 링크와 선택 상태를 유지한다.

- GitHub App 설치 전: 설치가 필요하다는 비활성 안내
- 허용 repository 없음: GitHub App 설정에서 허용된 저장소가 없다는 빈 상태
- 검색 결과 없음: 검색 조건과 일치하는 저장소가 없다는 빈 상태
- 선택됨: repository 이름, visibility, 보관 상태, 마지막 동기화 같은 실제 데이터만 표시

repository 선택은 Project v2 목록과 repository 범위 동기화의 기준이 된다. Pull Request 목록을
보여주거나 Pull Request 조회 기준이라는 설명은 제거한다.

## Project v2와 활성 Board 변경

Project v2는 독립 섹션으로 표시한다. 본문에는 현재 활성 Board의 Project 이름과 owner 종류를
요약하고 `보드 변경` 버튼을 둔다.

`보드 변경` 버튼은 shadcn/ui `Dialog` 기반 선택 모달을 연다.

- 선택한 repository에 연결된 Project v2만 표시한다.
- 현재 활성 Board를 명시한다.
- personal Project는 Project 작업 권한 필요 여부를 표시한다.
- Project 항목을 선택하면 기존 활성 Board 전환 API를 즉시 호출한다.
- 성공하면 모달을 닫고 현재 활성 Board 표시를 갱신한다.
- 실패하면 기존 Board를 유지하고 모달 안에 오류와 재시도 가능 상태를 표시한다.
- 별도의 가짜 Project나 통계는 만들지 않는다.

## 동기화

동기화는 Project v2와 분리된 독립 섹션이다.

1. `동기화 대상` select와 `동기화 시작` 버튼을 같은 행에 배치한다.
2. 그 아래에 최근 수동 실행 목록을 표시한다.

기본 대상은 기존과 같이 `전체`다. 선택지는 기존 API가 지원하는 `소스`, `전체`, `저장소`,
`Issue`, `Pull Request`, `Project v2`, `Project v2 필드`, `Project v2 아이템`을 유지한다.
repository나 Project 선택이 필요한 대상은 선행 선택이 없을 때 비활성화하거나 실행 전에 가까운
위치에서 이유를 안내한다. 개인 Project 작업 권한이 필요한 대상도 같은 방식으로 안내한다.

최근 수동 실행에는 API가 반환한 대상, 상태, 완료 시각과 오류만 표시한다. 기록이 없으면
“아직 수동 동기화 기록이 없습니다”라는 빈 상태를 표시하며 임의 실행 내역은 만들지 않는다.

## Pull Request 설정 목록 제거

GitHub 설정 화면의 Pull Request 카드와 이를 위한 상태, request gate, repository 선택 시 목록 조회를
제거한다. 다음 항목은 그대로 유지한다.

- GitHub Integration API client의 Pull Request 조회 메서드와 타입
- 서버의 Pull Request sync와 조회 계약
- Home Dashboard의 Pull Request 조회
- PR Review의 Pull Request 상세, diff, review, merge 흐름
- 수동 동기화 대상의 `Pull Request` 옵션

따라서 이 변경은 설정 화면에서만 불필요한 조회를 없애며 PILO의 Pull Request 기능을 축소하지 않는다.

## 컴포넌트 경계

- `settings`는 기존 `githubContent` 주입과 탭 진입점만 유지한다.
- `github-integration`이 연결, repository, Project v2, 동기화 UI와 API 호출을 소유한다.
- 기존 GitHub 연결 컴포넌트를 연결 단계, repository, Project 선택 Dialog, 동기화 섹션 단위로 유지하거나 분리한다.
- 공통 `src/components/ui` primitive는 수정하지 않는다.
- 도메인 전용 상태나 API 호출을 `settings` 또는 `shared`로 이동하지 않는다.

## 상태와 오류 처리

- 최초 로딩: 각 섹션 형태를 유지하는 Skeleton
- 전체 조회 실패: 상단 상태 알림과 새로고침
- 개별 action 실패: 해당 action과 가까운 위치의 오류
- OAuth/App redirect 중: 해당 버튼만 loading 및 중복 실행 방지
- App 설치 해제: 기존 명시적 확인 절차 유지
- Board 변경 중: 선택 항목 loading, 다른 선택 중복 방지
- Board 변경 실패: 모달 유지, 기존 활성 Board 유지
- 동기화 중: 시작 버튼 loading, 최근 실행 polling 유지
- 빈 상태: repository, Project, 수동 실행별로 원인을 구분

## 접근성

- 단계 번호만으로 상태를 전달하지 않고 상태 텍스트를 함께 표시한다.
- disabled 버튼의 이유를 인접한 설명으로 제공한다.
- Dialog는 제목과 설명을 가지며 열릴 때 현재 선택 또는 첫 항목으로 초점을 이동한다.
- Project 선택 성공 후 초점은 `보드 변경` 버튼으로 돌아간다.
- 색상만으로 성공·경고·오류를 구분하지 않는다.

## 테스트와 검증

테스트는 공통 테스트 러너용 새 fixture를 만들지 않고 `apps/frontend/src/features/github-integration/`
아래에 둔다.

- 연결 단계별 disabled/enabled 상태
- Project 작업 권한의 선택 사항 및 보드 편집 요구 안내
- GitHub 설정 Pull Request 카드와 화면 전용 조회 제거
- repository 미선택 시 Project/동기화 제약
- Board 변경 모달의 즉시 전환 요청
- Board 변경 실패 시 기존 Board 유지
- 동기화 대상 select와 실행 버튼의 같은 행 배치
- 최근 수동 실행의 실제 데이터 및 빈 상태

검증 명령은 구현 후 현재 frontend script 구성을 기준으로 다음을 사용한다.

```text
node --experimental-strip-types src/features/github-integration/github-settings-redesign.test.mjs
npm run lint
npm run build
```

전체 frontend 공통 테스트 러너는 변경하지 않는다. 빌드는 환경 문제로 수행할 수 없는 경우 정확한
오류와 미수행 사유를 남긴다.

## 소유권과 영향 범위

- GitHub Integration 소유자: 주형
- Settings 소유자: 동현
- Board 소유자: 주형
- API 계약 변경: 없음
- DB schema 변경: 없음
- Frontend 공통 영역 변경: 없음
- 팀 공통 규칙 변경: 없음

Settings Dialog의 `githubContent` 경계는 사용하지만 수정 범위는 GitHub Integration 도메인 내부를
우선한다. 구현 중 `src/features/settings/`, `src/components/`, `src/shared/` 변경이 새로 필요해지면
공통 또는 다른 도메인 영향 여부를 다시 확인하고 사용자에게 알린 뒤 진행한다.

## 완료 기준

- GitHub 탭이 다른 설정 탭과 같은 단일 열 밀도와 톤을 가진다.
- 연결 단계의 선행 조건과 Project 작업 권한의 의미가 명확하다.
- repository, 활성 Board, 동기화 작업이 서로 분리되어 이해된다.
- Pull Request 목록이 설정에서 제거되지만 다른 PR 기능은 유지된다.
- 실제 데이터가 없을 때 가짜 통계나 실행 내역을 표시하지 않는다.
- 도메인 테스트, TypeScript 검사와 가능한 빌드 검증 결과가 기록된다.
