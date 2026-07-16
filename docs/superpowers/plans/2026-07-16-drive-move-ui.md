# Drive 이동 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workspace 멤버가 Drive 목록에서 폴더, 파일, native 문서를 루트 또는 다른 폴더로 이동할 수 있게 한다.

**Architecture:** 기존 `PATCH /drive/items/{itemId}` request body를 frontend type의 union으로 표현한다. `DrivePanel`은 기존 `Sheet`와 `listItems` API를 재사용해 목적지 폴더를 한 단계씩 탐색하고, 선택한 parent id만 update request로 보낸다. 서버가 최종 권한, cycle, sibling name 충돌을 검증하며 UI는 성공 후 현재 목록을 다시 불러오고 오류를 Sheet 안에 표시한다.

**Tech Stack:** Next.js, React, TypeScript, shadcn/ui Sheet/DropdownMenu, lucide-react, existing Drive API client.

## Global Constraints

- API 계약과 DB schema는 변경하지 않는다. `PATCH` body는 `{ parentId: string | null }`만 보낸다.
- 변경 범위는 `apps/frontend/src/features/drive/**`와 기능 체크리스트 문서로 제한한다.
- 목적지 목록은 기존 `GET /drive/items?parentId=`를 사용하고 folder item만 탐색한다.
- 현재 parent, 이동 대상 자기 자신, 이동 대상 folder의 하위 folder는 선택할 수 없다. 서버 검증은 항상 유지한다.
- 신규 UI primitive나 route bridge는 추가하지 않는다.

---

### Task 1: 이동 API 타입과 계약 테스트

**Files:**
- Modify: `apps/frontend/src/features/drive/types/index.ts`
- Modify: `apps/frontend/src/features/drive/drive-document-contract.test.mjs`

**Interfaces:**
- Produces: `UpdateDriveItemInput = { name: string } | { parentId: string | null }`
- Consumed by: `createDriveApiClient().updateItem()` and `DrivePanel`

- [x] Write the failing assertion for the `parentId` union and run `node src/features/drive/drive-document-contract.test.mjs`.
- [x] Replace the rename-only type with `| { parentId: string | null }`, rerun the test, and commit `feat: Drive 이동 API 타입 추가 (#1170)`.

### Task 2: 이동 대상 탐색 Sheet와 mutation 상태

**Files:**
- Modify: `apps/frontend/src/features/drive/components/drive-panel.tsx`
- Modify: `apps/frontend/src/features/drive/drive-document-contract.test.mjs`

**Interfaces:**
- Consumes: `DriveItem`, `DriveListPayload`, `driveClient.listItems()`, `driveClient.updateItem()`
- Produces: `MoveItemSheet` and `DrivePanel` move open/navigate/confirm handlers

- [x] Add failing source-contract assertions for `MoveItemSheet`, `onOpenMove`, and `{ parentId: moveDestinationParentId }`.
- [x] Add an `이동` action to every Drive item row. It opens a feature-local Sheet that shows a root destination, breadcrumbs, and children filtered to folders.
- [x] Navigate one folder level at a time with `listItems`; disable the current parent, the selected folder itself, and a folder item that is a known invalid descendant destination.
- [x] Send `updateItem(workspaceId, item.id, { parentId })`, keep the Sheet open with its error on failure, and close/reload the source list on success.
- [x] Re-run the focused test and commit `feat: Drive 항목 이동 UI 추가 (#1170)`.

### Task 3: Checklist, verification, and PR

**Files:**
- Modify: `docs/superpowers/plans/2026-07-16-document-foundation-and-lifecycle.md`
- Modify: `docs/superpowers/plans/2026-07-16-drive-move-ui.md`

- [x] Mark completed checklist items and record PR [#1175](https://github.com/Developer-EJ/PILO/pull/1175).
- [x] Run `npm.cmd run lint`, `npm.cmd test` in `apps/frontend`, and `git diff --check` from the worktree.
- [ ] Perform local UI QA for root/nested move, disabled same-parent destination, API failure display, and preserved rename/delete/download/document-open behavior when an authenticated dev session is available. The local `/files` route redirected to login, so authenticated mutation QA is unavailable in this worktree.
- [x] Commit `docs: Drive 이동 UI 체크리스트 갱신 (#1170)` and open non-draft PR [#1175](https://github.com/Developer-EJ/PILO/pull/1175) to `dev` with `Closes #1170`.
