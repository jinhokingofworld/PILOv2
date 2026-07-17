# Drive Realtime Membership Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove a revoked Workspace member from PDF collaboration rooms and native document Hocuspocus connections on every Realtime Server instance.

**Architecture:** Reuse the existing `workspace:membership-revocations` Redis event V1. Move its event validator out of the Chat domain so Drive handlers can consume it without a Chat dependency. The PDF handler clears local room state then leaves matching Socket.IO rooms; the document handler closes only Hocuspocus connections whose authenticated context matches the revoked Workspace and user.

**Tech Stack:** TypeScript, Socket.IO, Redis pub/sub, Hocuspocus 4.4.0, Node built-in test runner.

## Global Constraints

- Reuse `membership.revoked` event V1; do not change API endpoints or DB schema.
- Do not store document content, access tokens, or connection payloads in revocation state.
- Run focused realtime tests only; do not run unrelated frontend or App Server suites.
- Keep Canvas and PR Review Canvas outside this change.

---

### Task 1: Extract the shared revocation event contract

**Files:**
- Create: `apps/realtime-server/src/workspace-membership-revocation/workspace-membership-revocation.ts`
- Modify: `apps/realtime-server/src/chat/chat-membership-revocation.ts`
- Test: `apps/realtime-server/src/chat/chat-membership-revocation.test.mjs`

**Interfaces:**
- Produces `WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL`, `WorkspaceMembershipRevokedEventV1`, and `isWorkspaceMembershipRevokedEvent(payload)` for Chat, PDF, and Documents.

- [x] Write a test that imports the shared contract and accepts only an exact V1 revocation payload.
- [x] Run the test and verify it fails because the shared module is absent.
- [x] Move the existing validator and channel constant from Chat into the shared module, then update Chat imports without changing Chat behavior.
- [x] Run the focused Chat revocation test and verify it passes.
- [x] Commit the shared contract extraction.

### Task 2: Evict revoked users from PDF collaboration

**Files:**
- Create: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-membership-revocation.ts`
- Modify: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-room-state.ts`
- Modify: `apps/realtime-server/src/socket/socket-server.ts`
- Test: `apps/realtime-server/src/pdf-collaboration/pdf-collaboration-membership-revocation.test.mjs`

**Interfaces:**
- Consumes the shared V1 event and `PdfCollaborationRoomState`.
- Produces `createPdfCollaborationMembershipRevocationHandler({ io, roomState })`.
- Adds `roomState.clearWorkspaceSocket(socketId, workspaceId)` returning removed PDF presence records.

- [x] Write a failing test where a revoked user with two local PDF tabs is removed from only the matching Workspace, receives Socket.IO `leave` calls, and emits presence leave events.
- [x] Run the test and verify it fails because the PDF revocation handler is absent.
- [x] Implement the smallest handler: scan local sockets by authenticated user ID, clear matching PDF presence/pointers, leave each matching room, and notify remaining participants.
- [x] Subscribe the handler beside Chat in the existing membership revocation subscriber; keep page/pointer/stroke handlers unchanged so the removed room membership causes their existing `room_not_joined` rejection.
- [x] Run the PDF handler and room-state tests, then commit.

### Task 3: Close revoked native document connections

**Files:**
- Create: `apps/realtime-server/src/documents/document-membership-revocation.ts`
- Modify: `apps/realtime-server/src/documents/document-hocuspocus.service.ts`
- Modify: `apps/realtime-server/src/server.ts`
- Modify: `apps/realtime-server/src/socket/socket-server.ts`
- Test: `apps/realtime-server/src/documents/document-membership-revocation.test.mjs`

**Interfaces:**
- Produces `createDocumentMembershipRevocationHandler({ hocuspocus })`.
- The handler walks active Hocuspocus documents and closes only connections whose `context.workspaceId` and `context.userId` match the event.
- `createRealtimeSocketServer` accepts additional membership-revocation handlers supplied by the bootstrap.

- [x] Write a failing test with matching and non-matching Hocuspocus connections; expect only matching connections to close with an access-revoked close event.
- [x] Run the test and verify it fails because the document revocation handler is absent.
- [x] Implement the handler using Hocuspocus public active-document and connection APIs, and register it during server bootstrap.
- [x] Ensure the Redis subscriber waits for both Chat and Document handlers before shutdown continues.
- [x] Run focused document and socket contract tests, then commit.

### Task 4: Verify and prepare review

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-drive-realtime-membership-revocation.md`

- [x] Run `npm.cmd run build --prefix apps/realtime-server`.
- [x] Run the focused Chat, PDF, and document revocation tests.
- [x] Run `git diff --check` and inspect the final diff for accidental Canvas or frontend changes.
- [x] Mark completed plan tasks and commit the tracking update.
