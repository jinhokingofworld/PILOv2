# GitHub Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub 설정 탭을 단계형 연결, repository 선택, 즉시 적용되는 활성 Board 선택, 독립된 수동 동기화 섹션으로 재구성하고 설정 전용 Pull Request 목록 조회를 제거한다.

**Architecture:** Settings의 `githubContent` 주입 경계와 기존 API 계약은 유지한다. `github-integration` 안에서 연결 단계 정책을 순수 함수로 분리하고, repository·Project v2·동기화 섹션을 각각 독립 컴포넌트로 구성한다. `GithubPanel`은 데이터와 action을 소유하고 `GithubConnectLayout`은 단일 열 조합만 담당한다.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, lucide-react, Node.js `assert`

## Global Constraints

- shadcn/ui 기반 컴포넌트만 조합하고 `src/components/ui/` primitive는 수정하지 않는다.
- 카드 radius는 8~10px 수준으로 유지하며 큰 hero, 중첩 카드, 마케팅 카피를 추가하지 않는다.
- 흰 배경, 얕은 그림자, 저대비 색상과 실제 콘텐츠보다 약한 배경 그래픽을 사용한다.
- 실제 API 데이터가 없는 통계, Project, 실행 기록을 만들지 않는다.
- Pull Request API·타입·서버 sync·Home·PR Review·수동 동기화 대상은 유지한다.
- API 계약, DB schema, Settings 도메인, frontend 공통영역은 변경하지 않는다.
- 새 테스트는 `apps/frontend/src/features/github-integration/` 아래에 둔다.
- 모든 커밋 메시지는 이슈 `#1507`을 포함한다.

---

## File Map

- Create `apps/frontend/src/features/github-integration/utils/github-settings-access.ts`: 연결 단계 활성화와 안내 상태를 계산하는 순수 정책.
- Create `apps/frontend/src/features/github-integration/github-settings-redesign.test.mjs`: 정책과 컴포넌트 구조를 검증하는 도메인 테스트.
- Modify `apps/frontend/src/features/github-integration/components/github-connect-steps.tsx`: 순차 활성화 연결 섹션.
- Create `apps/frontend/src/features/github-integration/components/github-connect-repositories.tsx`: repository 검색·선택·페이지네이션 섹션.
- Create `apps/frontend/src/features/github-integration/components/github-connect-project.tsx`: 현재 활성 Board와 즉시 적용 Dialog.
- Create `apps/frontend/src/features/github-integration/components/github-connect-sync.tsx`: 대상 선택/실행과 최근 수동 실행 섹션.
- Modify `apps/frontend/src/features/github-integration/components/github-connect-layout.tsx`: 새 섹션의 단일 열 조합.
- Modify `apps/frontend/src/features/github-integration/components/github-panel.tsx`: 설정 전용 PR 상태/조회 제거와 Board 즉시 전환 action 제공.
- Delete `apps/frontend/src/features/github-integration/components/github-connect-tables.tsx`: repository, PR, Project 혼합 컴포넌트를 책임별 컴포넌트로 대체.
- Delete `apps/frontend/src/features/github-integration/components/github-connect-sidebar.tsx`: 동기화 sidebar를 단일 열 섹션으로 대체.
- Modify `apps/frontend/scripts/github-integration/test.mjs`: 삭제된 컴포넌트 assertion을 제거하고 새 도메인 테스트를 import한다.

---

### Task 1: 연결 단계 정책과 도메인 테스트

**Files:**
- Create: `apps/frontend/src/features/github-integration/utils/github-settings-access.ts`
- Create: `apps/frontend/src/features/github-integration/github-settings-redesign.test.mjs`

**Interfaces:**
- Consumes: `connected: boolean`, `hasInstallation: boolean`, `projectOAuthConnected: boolean`
- Produces: `getGithubSettingsAccessState(input): GithubSettingsAccessState`

- [ ] **Step 1: 연결 단계 정책의 실패 테스트를 작성한다**

`github-settings-redesign.test.mjs`에 다음 정책 검증을 작성한다.

```js
import assert from "node:assert/strict";
import { getGithubSettingsAccessState } from "./utils/github-settings-access.ts";

assert.deepEqual(
  getGithubSettingsAccessState({
    connected: false,
    hasInstallation: false,
    projectOAuthConnected: false
  }),
  {
    canInstallGithubApp: false,
    canConnectProjectOAuth: false,
    canChooseRepository: false,
    githubStepStatus: "required",
    installationStepStatus: "blocked",
    projectStepStatus: "blocked"
  }
);

assert.equal(
  getGithubSettingsAccessState({
    connected: true,
    hasInstallation: false,
    projectOAuthConnected: false
  }).canInstallGithubApp,
  true
);

assert.deepEqual(
  getGithubSettingsAccessState({
    connected: true,
    hasInstallation: true,
    projectOAuthConnected: false
  }),
  {
    canInstallGithubApp: true,
    canConnectProjectOAuth: true,
    canChooseRepository: true,
    githubStepStatus: "complete",
    installationStepStatus: "complete",
    projectStepStatus: "optional"
  }
);
```

- [ ] **Step 2: 정책 테스트가 실패하는지 확인한다**

Run:

```powershell
node --experimental-strip-types src/features/github-integration/github-settings-redesign.test.mjs
```

Working directory: `apps/frontend`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `github-settings-access.ts`.

- [ ] **Step 3: 최소 연결 단계 정책을 구현한다**

`github-settings-access.ts`에 다음 타입과 함수를 작성한다.

```ts
export type GithubSettingsStepStatus =
  | "required"
  | "blocked"
  | "complete"
  | "optional";

export type GithubSettingsAccessState = {
  canInstallGithubApp: boolean;
  canConnectProjectOAuth: boolean;
  canChooseRepository: boolean;
  githubStepStatus: GithubSettingsStepStatus;
  installationStepStatus: GithubSettingsStepStatus;
  projectStepStatus: GithubSettingsStepStatus;
};

export function getGithubSettingsAccessState({
  connected,
  hasInstallation,
  projectOAuthConnected
}: {
  connected: boolean;
  hasInstallation: boolean;
  projectOAuthConnected: boolean;
}): GithubSettingsAccessState {
  return {
    canInstallGithubApp: connected,
    canConnectProjectOAuth: connected && hasInstallation,
    canChooseRepository: connected && hasInstallation,
    githubStepStatus: connected ? "complete" : "required",
    installationStepStatus: !connected
      ? "blocked"
      : hasInstallation
        ? "complete"
        : "required",
    projectStepStatus:
      !connected || !hasInstallation
        ? "blocked"
        : projectOAuthConnected
          ? "complete"
          : "optional"
  };
}
```

- [ ] **Step 4: 정책 테스트를 통과시킨다**

Run the Step 2 command.

Expected: exit code `0` and no assertion output.

- [ ] **Step 5: 정책과 테스트를 커밋한다**

```powershell
git add apps/frontend/src/features/github-integration/utils/github-settings-access.ts apps/frontend/src/features/github-integration/github-settings-redesign.test.mjs
git commit -m "test: GitHub 설정 연결 단계 정책 추가 (#1507)"
```

---

### Task 2: 순차 활성화 연결 섹션

**Files:**
- Modify: `apps/frontend/src/features/github-integration/components/github-connect-steps.tsx`
- Modify: `apps/frontend/src/features/github-integration/github-settings-redesign.test.mjs`

**Interfaces:**
- Consumes: `getGithubSettingsAccessState`, 기존 OAuth/App/Project OAuth action props
- Produces: 한 장의 `GithubConnectPanel` 안에 세 개의 연결 행

- [ ] **Step 1: 연결 섹션 구조의 실패 assertion을 추가한다**

테스트 파일에서 컴포넌트 소스를 읽고 다음을 검증한다.

```js
import { readFile } from "node:fs/promises";

const stepsSource = await readFile(
  new URL("./components/github-connect-steps.tsx", import.meta.url),
  "utf8"
);

assert.match(stepsSource, /1\. GitHub 계정 연결/);
assert.match(stepsSource, /2\. GitHub App 설치/);
assert.match(stepsSource, /3\. Project 작업 권한/);
assert.match(stepsSource, /보드 편집 시 필요/);
assert.match(stepsSource, /getGithubSettingsAccessState/);
assert.doesNotMatch(stepsSource, /grid-cols-3/);
assert.doesNotMatch(stepsSource, /title="현재 작업"/);
```

- [ ] **Step 2: 테스트가 기존 카드 그리드 때문에 실패하는지 확인한다**

Run the Task 1 test command.

Expected: FAIL on `3. Project 작업 권한`, `getGithubSettingsAccessState`, or `grid-cols-3`.

- [ ] **Step 3: 연결 카드 UI를 행 구조로 재구성한다**

`GithubConnectSteps`에서 정책을 계산한다.

```tsx
const access = getGithubSettingsAccessState({
  connected,
  hasInstallation,
  projectOAuthConnected
});
```

세 단계는 `divide-y`를 가진 단일 목록으로 렌더링한다. 버튼 조건은 다음과 같이 고정한다.

```tsx
<Button disabled={!access.canInstallGithubApp || isLoading || redirectAction === "installation"}>
  설치 시작
</Button>

<Button disabled={!access.canConnectProjectOAuth || isLoading || redirectAction === "project_oauth"}>
  Project 작업 권한 연결
</Button>
```

3단계 설명은 `Project 조회 확장 · 카드 이동 · 새 이슈 생성`으로 하고, 미연결이지만 활성화된 상태에는
`보드 편집 시 필요` badge를 표시한다. 선행 단계가 없으면 button text를 각각 `1단계 필요`,
`2단계 필요`로 표시한다. 기존 연결 해제, 설치 해제 확인, loading action은 유지한다.

- [ ] **Step 4: 도메인 테스트와 TypeScript 검사를 실행한다**

Run:

```powershell
node --experimental-strip-types src/features/github-integration/github-settings-redesign.test.mjs
npm run lint
```

Expected: both commands exit `0`.

- [ ] **Step 5: 연결 섹션을 커밋한다**

```powershell
git add apps/frontend/src/features/github-integration/components/github-connect-steps.tsx apps/frontend/src/features/github-integration/github-settings-redesign.test.mjs
git commit -m "feat: GitHub 연결 단계를 순차 활성화한다 (#1507)"
```

---

### Task 3: Repository와 Project v2 섹션 분리 및 Board 즉시 전환

**Files:**
- Create: `apps/frontend/src/features/github-integration/components/github-connect-repositories.tsx`
- Create: `apps/frontend/src/features/github-integration/components/github-connect-project.tsx`
- Modify: `apps/frontend/src/features/github-integration/components/github-panel.tsx`
- Modify: `apps/frontend/src/features/github-integration/github-settings-redesign.test.mjs`

**Interfaces:**
- `GithubConnectRepositories` consumes repository data/search/page/select props and `enabled: boolean`.
- `GithubConnectProject` consumes `projects`, `activeProjectV2Id`, `selectedRepository`, `projectOAuthConnected`, `isWorkspaceOwner`, `isActivating`, and `onActivateProjectV2(projectV2Id): Promise<void>`.
- `GithubPanel.handleActivateProjectV2(projectV2Id)` resolves only after the existing active Board source API succeeds.

- [ ] **Step 1: 새 섹션과 즉시 적용 동작의 실패 assertion을 추가한다**

```js
const repositorySource = await readFile(
  new URL("./components/github-connect-repositories.tsx", import.meta.url),
  "utf8"
);
const projectSource = await readFile(
  new URL("./components/github-connect-project.tsx", import.meta.url),
  "utf8"
);
const panelSource = await readFile(
  new URL("./components/github-panel.tsx", import.meta.url),
  "utf8"
);

assert.match(repositorySource, /Project를 조회하고 동기화할 repository/);
assert.doesNotMatch(repositorySource, /Pull Request 조회 기준/);
assert.match(projectSource, /@\/components\/ui\/dialog/);
assert.match(projectSource, /활성 Board 변경/);
assert.match(projectSource, /await onActivateProjectV2\(project\.id\)/);
assert.match(panelSource, /async function handleActivateProjectV2\(projectV2Id: string\)/);
assert.match(panelSource, /await apiClient\.activateWorkspaceBoardSource/);
```

- [ ] **Step 2: 새 컴포넌트가 없어 테스트가 실패하는지 확인한다**

Run the Task 1 test command.

Expected: FAIL with `ENOENT` for `github-connect-repositories.tsx`.

- [ ] **Step 3: repository 섹션을 분리한다**

기존 `GithubConnectSourceTables`의 repository 검색, 표, 페이지네이션과 `RepositoryRow`를
`GithubConnectRepositories`로 옮긴다. 제목은 `저장소`, 설명은
`Project를 조회하고 동기화할 repository를 선택합니다.`로 사용한다. `enabled`가 false이면 표 대신
`GitHub App 설치 후 저장소를 선택할 수 있습니다.` 빈 상태를 렌더링한다.

- [ ] **Step 4: Project v2 Dialog를 구현한다**

`GithubConnectProject`는 현재 활성 Project 요약과 `보드 변경` 버튼을 렌더링한다. Dialog 내부에서
실제 `projects`만 나열하고 다음 선택 handler를 사용한다.

```tsx
async function handleProjectChoice(projectV2Id: string) {
  setDialogError(null);
  try {
    await onActivateProjectV2(projectV2Id);
    setOpen(false);
  } catch (error) {
    setDialogError(
      error instanceof Error ? error.message : "활성 Board를 변경하지 못했습니다."
    );
  }
}
```

현재 항목에는 `현재 Board`, personal owner에는 Project 작업 권한이 없을 때 `작업 권한 필요`를 표시한다.
빈 `projects` 배열이면 가짜 항목 대신 `선택한 repository에 연결된 Project v2가 없습니다.`를 표시한다.

- [ ] **Step 5: 부모 action을 성공 후 상태 변경 방식으로 바꾼다**

기존 `handleSaveProjectV2Selections`를 다음 signature의 `handleActivateProjectV2`로 교체한다.

```ts
async function handleActivateProjectV2(projectV2Id: string) {
  if (!workspaceId || !selectedRepositoryId) {
    throw new Error("repository를 먼저 선택해주세요.");
  }
  if (!isWorkspaceOwner) {
    throw new Error("Workspace Owner만 활성 Board를 변경할 수 있습니다.");
  }

  setIsSavingProjectV2Selections(true);
  try {
    await apiClient.activateWorkspaceBoardSource(workspaceId, {
      repositoryId: selectedRepositoryId,
      projectV2Id
    });
    setSelectedProjectV2Id(projectV2Id);
    setActionMessage("활성 Board를 변경했습니다.");
    void refreshGithubSyncRuns();
  } finally {
    setIsSavingProjectV2Selections(false);
  }
}
```

활성 Board API 실패 시 `setSelectedProjectV2Id`를 호출하지 않아 기존 Board 선택을 유지한다. API 성공
후 부가 sync run refresh는 모달 성공 여부를 뒤집지 않는다. `handleSelectRepository`의
Project discovery가 `connectionRequired`를 반환해도 OAuth를 자동 시작하지 않고, 3단계 연결 action을
사용하도록 안내 상태만 설정한다.

- [ ] **Step 6: 도메인 테스트와 TypeScript 검사를 실행한다**

Run the Task 2 verification commands.

Expected: both commands exit `0`.

- [ ] **Step 7: repository와 Project 섹션을 커밋한다**

```powershell
git add apps/frontend/src/features/github-integration/components/github-connect-repositories.tsx apps/frontend/src/features/github-integration/components/github-connect-project.tsx apps/frontend/src/features/github-integration/components/github-panel.tsx apps/frontend/src/features/github-integration/github-settings-redesign.test.mjs
git commit -m "feat: repository와 활성 Board 선택을 분리한다 (#1507)"
```

---

### Task 4: 동기화 섹션 분리와 Pull Request 설정 조회 제거

**Files:**
- Create: `apps/frontend/src/features/github-integration/components/github-connect-sync.tsx`
- Modify: `apps/frontend/src/features/github-integration/components/github-connect-layout.tsx`
- Modify: `apps/frontend/src/features/github-integration/components/github-panel.tsx`
- Delete: `apps/frontend/src/features/github-integration/components/github-connect-tables.tsx`
- Delete: `apps/frontend/src/features/github-integration/components/github-connect-sidebar.tsx`
- Modify: `apps/frontend/src/features/github-integration/github-settings-redesign.test.mjs`
- Modify: `apps/frontend/scripts/github-integration/test.mjs`

**Interfaces:**
- `GithubConnectSync` consumes existing `syncTarget`, `syncRuns`, `syncRunsTotal`, installation/repository state and sync callbacks.
- `GithubConnectLayout` composes Steps → Repositories → Project → Sync in one `grid gap-4` column.
- `GithubPanel` no longer owns settings-only Pull Request collection state.

- [ ] **Step 1: 최종 구조와 PR 제거의 실패 assertion을 작성한다**

```js
const layoutSource = await readFile(
  new URL("./components/github-connect-layout.tsx", import.meta.url),
  "utf8"
);
const syncSource = await readFile(
  new URL("./components/github-connect-sync.tsx", import.meta.url),
  "utf8"
);

assert.match(layoutSource, /GithubConnectRepositories/);
assert.match(layoutSource, /GithubConnectProject/);
assert.match(layoutSource, /GithubConnectSync/);
assert.doesNotMatch(layoutSource, /main-grid/);
assert.match(syncSource, /동기화 대상/);
assert.match(syncSource, /동기화 시작/);
assert.match(syncSource, /최근 수동 실행/);
assert.match(syncSource, /아직 수동 동기화 기록이 없습니다/);
assert.doesNotMatch(panelSource, /loadGithubPullRequests/);
assert.doesNotMatch(panelSource, /pullRequestsRequestGateRef/);
assert.doesNotMatch(panelSource, /setPullRequests/);
```

- [ ] **Step 2: 새 동기화 컴포넌트가 없어 테스트가 실패하는지 확인한다**

Run the Task 1 test command.

Expected: FAIL with `ENOENT` for `github-connect-sync.tsx`.

- [ ] **Step 3: 동기화 섹션을 구현한다**

기존 sidebar의 대상 select, 시작 버튼, 최근 수동 동기화 목록과 loading rows를 새
`GithubConnectSync`로 옮긴다. select와 시작 버튼은 동일한 flex row에 배치한다. 최근 실행은 그 아래에
표시하며 `syncRuns.length === 0`일 때 다음 실제 빈 상태를 사용한다.

```tsx
<GithubConnectEmptyState>
  아직 수동 동기화 기록이 없습니다. 대상을 선택해 첫 동기화를 시작할 수 있습니다.
</GithubConnectEmptyState>
```

기존 target 목록, polling 상태, 진행률과 오류 메시지는 유지한다. 최근 실행 count를 별도 통계 카드로
만들지 않는다.

- [ ] **Step 4: Layout을 단일 열로 조합한다**

`GithubConnectLayout`의 `main-grid`와 muted container 배경을 제거하고 다음 순서로 렌더링한다.

```tsx
<div className="github-connect-root @container text-foreground">
  <div className="grid gap-4">
    {notices}
    <GithubConnectSteps {...stepProps} />
    <GithubConnectRepositories {...repositoryProps} />
    <GithubConnectProject {...projectProps} />
    <GithubConnectSync {...syncProps} />
  </div>
</div>
```

각 panel은 `rounded-[9px] border bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]` 수준의 톤을
사용하고 내부에 또 다른 Card를 만들지 않는다.

- [ ] **Step 5: 설정 화면 전용 Pull Request 조회를 제거한다**

`github-panel.tsx`에서 다음만 제거한다.

- `GithubPullRequest` import
- `pullRequests`, `pullRequestsTotal`, `isPullRequestsLoading` state
- `pullRequestsRequestGateRef`
- `loadGithubPullRequests`
- snapshot/repository 변경 시 PR clear/load 호출
- Layout으로 전달하는 PR props

`api/client.ts`, `types/index.ts`, 서버 코드, Home, PR Review, `syncTargetOptions`의 `pull_requests`는
수정하지 않는다.

- [ ] **Step 6: 기존 script assertion을 새 구조로 갱신한다**

`apps/frontend/scripts/github-integration/test.mjs`에서 삭제한 tables/sidebar 파일 read와 Pull Request
카드 assertion을 제거한다. 파일 끝에 다음 import를 추가한다.

```js
await import("../../src/features/github-integration/github-settings-redesign.test.mjs");
```

- [ ] **Step 7: 도메인 테스트, 기존 GitHub Integration script와 TypeScript 검사를 실행한다**

Run:

```powershell
node --experimental-strip-types src/features/github-integration/github-settings-redesign.test.mjs
node scripts/github-integration/test.mjs
npm run lint
```

Expected: all commands exit `0`.

- [ ] **Step 8: 최종 UI 구조를 커밋한다**

```powershell
git add -A apps/frontend/src/features/github-integration apps/frontend/scripts/github-integration/test.mjs
git commit -m "feat: GitHub 설정을 단일 열 관리 화면으로 재구성한다 (#1507)"
```

---

### Task 5: 최종 검증과 문서 일치 확인

**Files:**
- Verify only: `apps/frontend/src/features/github-integration/`
- Verify only: `.personal/2026-07-19-github-settings-redesign-design.md`

**Interfaces:**
- Consumes: Tasks 1–4의 최종 branch state
- Produces: 구현·테스트·빌드 결과와 review 가능한 clean worktree

- [ ] **Step 1: 제한 경계를 확인한다**

Run:

```powershell
git diff origin/dev --name-only
```

Expected: `.personal` 문서, `apps/frontend/src/features/github-integration/`,
`apps/frontend/scripts/github-integration/test.mjs`만 출력된다. Settings, shared, ui primitive, API 문서,
app-server 파일이 나오면 중단하고 범위를 재검토한다.

- [ ] **Step 2: 전체 관련 검증을 다시 실행한다**

Working directory: `apps/frontend`

```powershell
node --experimental-strip-types src/features/github-integration/github-settings-redesign.test.mjs
node scripts/github-integration/test.mjs
npm run lint
npm run build
```

Expected: 모든 명령 exit code `0`. 환경 의존 문제로 build가 실패하면 동일 명령의 오류를 보존하고
코드 실패와 환경 실패를 구분한다.

- [ ] **Step 3: diff 품질을 확인한다**

```powershell
git diff --check origin/dev...HEAD
git status --short
```

Expected: `git diff --check` output 없음, `git status --short` output 없음.

- [ ] **Step 4: 디자인 요구사항을 source에서 확인한다**

```powershell
rg -n "Pull Requests|PILO GitHub Connect|grid-cols-3|main-grid" src/features/github-integration/components
rg -n "Project 작업 권한|보드 편집 시 필요|활성 Board 변경|최근 수동 실행" src/features/github-integration/components
```

Expected: 첫 명령은 설정용 legacy copy/layout match가 없고, 두 번째 명령은 새 구조의 실제 copy를 찾는다.

- [ ] **Step 5: 추가 수정이 있었다면 검증 커밋을 만든다**

검증 과정에서 코드 수정이 없으면 커밋하지 않는다. 수정이 있었다면 관련 파일만 stage하고 다음 메시지를 사용한다.

```powershell
git commit -m "fix: GitHub 설정 검증 결과를 반영한다 (#1507)"
```
