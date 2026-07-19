# Agent Document Resource Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent가 실제로 조회한 Drive 문서를 Tool 이름과 관계없이 원본 문서 링크로 제공한다.

**Architecture:** grounded-answer 공통 저장 경계에서 Tool의 명시적 `resourceRefs`와 `groundingSources[].resourceRef`를 병합하고 resource identity로 중복 제거한다. Frontend는 공통 allowlist 변환기로 검증된 MeetingReport·Drive 내부 링크만 표시한다.

**Tech Stack:** NestJS, TypeScript, Node.js contract tests, Next.js Agent resource link UI

## Global Constraints

- 실제로 조회 근거에 포함된 문서만 링크한다.
- 같은 `domain + resourceType + resourceId`는 한 번만 저장하고 표시한다.
- resource reference에 문서 원문, excerpt, embedding 점수를 저장하지 않는다.
- DB migration, confirmation, Activity Log는 추가하지 않는다.
- 인증, Workspace 권한, DB 오류는 숨기지 않는다.
- 작업 이슈 `#1583`에 연결하고 저장소 commit·PR 규칙을 따른다.

---

### Task 1: Grounded source reference 공통 병합

**Files:**
- Modify: `apps/app-server/src/modules/agent/agent-grounded-answer.service.ts`
- Test: `apps/app-server/scripts/agent/meeting-evidence-rag.test.mjs`

**Interfaces:**
- Consumes: `AgentToolExecutionResult.resourceRefs`, `AgentGroundingSourceCandidate.resourceRef`
- Produces: `mergeResourceRefs(explicitRefs, groundingRefs): AgentResourceRef[]`

- [ ] **Step 1: grounding source만으로 문서 reference가 저장되는 실패 테스트 작성**

`meeting-evidence-rag.test.mjs`에 같은 문서를 가리키는 Drive grounding source 두 개를 추가한다. 완료된 step의 `resource_refs`가 기존 MeetingReport와 Drive 문서를 각각 한 번만 포함하는지 확인한다.

```js
const documentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
await service.completeToolAndQueue({
  runId,
  workspaceId: WORKSPACE_ID,
  currentUserId: USER_ID,
  stepId,
  outputSummary: { status: "grounding_queued" },
  resourceRefs: [
    { domain: "meeting", resourceType: "meeting_report", resourceId: REPORT_ID }
  ],
  groundingSources: [
    {
      sourceType: "drive_document",
      sourceRef: "drive_chunk:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
      title: "비동기 처리 설계",
      excerpt: "Worker 배포 순서",
      score: 0.91,
      resourceRef: { domain: "drive", resourceType: "document", resourceId: documentId,
        label: "비동기 처리 설계", url: `/files?documentId=${documentId}` }
    },
    {
      sourceType: "drive_document",
      sourceRef: "drive_chunk:cccccccc-cccc-4ccc-8ccc-cccccccccc01",
      title: "비동기 처리 설계",
      excerpt: "이전 버전 롤백",
      score: 0.88,
      resourceRef: { domain: "drive", resourceType: "document", resourceId: documentId,
        label: "비동기 처리 설계", url: `/files?documentId=${documentId}` }
    }
  ],
  executionLease: { token: leaseToken, generation: 1 }
});

assert.deepEqual(JSON.parse(completedStep.values[3]), [
  { domain: "meeting", resourceType: "meeting_report", resourceId: REPORT_ID },
  { domain: "drive", resourceType: "document", resourceId: documentId,
    label: "비동기 처리 설계", url: `/files?documentId=${documentId}` }
]);
```

- [ ] **Step 2: RED 확인**

Run:

```powershell
npm.cmd run build
node scripts/agent/meeting-evidence-rag.test.mjs
```

Expected: 현재 구현이 명시적 reference와 grounding reference를 공통 병합하지 않아 새 assertion이 실패한다.

- [ ] **Step 3: 최소 병합 구현**

`AgentGroundedAnswerService.completeToolAndQueue`에서 registry를 만든 직후 저장용 reference를 계산한다.

```ts
const resourceRefs = this.mergeResourceRefs(
  input.resourceRefs,
  registry.map((entry) => entry.resourceRef)
);
```

명시적 Tool reference를 우선 보존하고 grounding reference는 `boundResourceRef`를 거쳐 추가한다.

```ts
private mergeResourceRefs(
  explicitRefs: AgentResourceRef[],
  groundingRefs: AgentResourceRef[]
): AgentResourceRef[] {
  const byIdentity = new Map<string, AgentResourceRef>();
  for (const reference of explicitRefs) {
    const key = JSON.stringify([
      reference.domain,
      reference.resourceType,
      reference.resourceId
    ]);
    if (!byIdentity.has(key)) byIdentity.set(key, reference);
  }
  for (const reference of groundingRefs) {
    const bounded = this.boundResourceRef(reference);
    const key = JSON.stringify([
      bounded.domain,
      bounded.resourceType,
      bounded.resourceId
    ]);
    if (!byIdentity.has(key)) byIdentity.set(key, bounded);
  }
  return [...byIdentity.values()].slice(0, 100);
}
```

step 저장의 `JSON.stringify(input.resourceRefs)`를 `JSON.stringify(resourceRefs)`로 교체한다.

- [ ] **Step 4: GREEN 확인**

Run:

```powershell
npm.cmd run build
node scripts/agent/meeting-evidence-rag.test.mjs
node scripts/agent/meeting-tools.test.mjs
```

Expected: 모두 exit code 0.

---

### Task 2: 문서 조회 Tool과 공통 링크 UI 계약 고정

**Files:**
- Modify: `apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts`
- Test: `apps/app-server/scripts/agent/meeting-tools.test.mjs`
- Modify: `apps/frontend/src/features/agent/resource-links.ts`
- Test: `apps/frontend/src/features/agent/agent-feature.test.mjs`

**Interfaces:**
- Consumes: `drive/document`, `meeting/meeting_report` 형태의 `AgentResourceRef`
- Produces: `/files?documentId=<uuid>`, `/report?reportId=<uuid>` 형태의 `AgentResourceLink`

- [ ] **Step 1: App Server 계약 확인**

`search_workspace_documents`와 `search_meeting_transcript`가 실제 검색 결과에 대해 Drive document reference를 반환하고, Meeting 조회·요약 reference가 MeetingReport URL을 포함하도록 유지한다. 관련 문서가 없거나 선택적 Drive embedding이 실패하면 Meeting 결과만 반환한다.

- [ ] **Step 2: Frontend allowlist 계약 확인**

`getAgentResourceLinks`는 SQLtoERD·Canvas 처리에 이어 MeetingReport·Drive document reference를 공통 변환한다. 정확한 domain, resource type, UUID, path, 단일 query parameter가 모두 일치하는 경우만 링크를 반환한다.

- [ ] **Step 3: 관련 테스트 실행**

Run:

```powershell
node --experimental-strip-types src/features/agent/agent-feature.test.mjs
npm.cmd run lint
```

Expected: 모두 exit code 0이고 변조 URL case는 빈 링크 배열을 반환한다.

---

### Task 3: Agent 계약 문서화와 최소 최종 검증

**Files:**
- Modify: `docs/api/agent-api.md`
- Verify: `apps/app-server/APP_SERVER_COMMON_AREAS.md`
- Verify: `apps/frontend/FRONTEND_COMMON_AREAS.md`

**Interfaces:**
- Consumes: Task 1의 공통 병합 규칙과 Task 2의 링크 allowlist
- Produces: Agent API의 문서 조회 resource reference 계약

- [ ] **Step 1: API 문서 반영**

grounded-answer Tool이 실제로 사용한 `groundingSources[].resourceRef`를 step `resourceRefs`에 병합하며, Drive document는 검증된 내부 링크로 표시된다는 내용을 기록한다. raw content와 점수는 resource reference에 포함하지 않는다고 명시한다.

- [ ] **Step 2: 공통 영역 영향 확인**

두 공통 영역 문서를 기준으로 `src/modules/agent/`와 `src/features/agent/`는 사이렌 공통 경로에 포함되지
않음을 확인한다. 다만 여러 도메인 Tool이 따르는 Agent 계약 변경이므로 이후 PR 본문에는 영향 범위와
검증 명령을 기록하고 Agent 담당자 리뷰 대상으로 표시한다.

- [ ] **Step 3: 최종 검증**

Run:

```powershell
git diff --check
```

그리고 다음 관련 검증만 실행한다.

```powershell
# apps/app-server
npm.cmd run build
node scripts/agent/meeting-evidence-rag.test.mjs
node scripts/agent/meeting-tools.test.mjs
npm.cmd run format:check

# apps/frontend
node --experimental-strip-types src/features/agent/agent-feature.test.mjs
npm.cmd run lint
npm.cmd run format:check
```

Expected: 모든 명령 exit code 0. 전체 테스트는 변경 범위 밖이므로 실행하지 않는다.

- [ ] **Step 4: 커밋 범위 확인**

`git status --short`로 변경 파일만 확인하고, 작업 이슈 `#1583`과 관련된 파일만 명시적으로 stage한다.
