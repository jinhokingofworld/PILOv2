# Meeting Report Title Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent가 회의록 제목으로 정확한 MeetingReport를 선택하고, 후보에 제목을 표시하도록 한다.

**Architecture:** 기존 MeetingReport contextual selector에 `reportTitle`을 추가한다. Agent 전용 Meeting 조회에서 표시 제목을 정규화해 정확히 비교하고, 기존 resolver의 단일 선택·복수 후보 처리 흐름을 그대로 재사용한다.

**Tech Stack:** TypeScript, NestJS, PostgreSQL, Node.js assert 기반 테스트

## Global Constraints

- 공개 Meeting REST API와 DB schema는 변경하지 않는다.
- `roomName`과 `reportTitle`은 별도 의미를 유지한다.
- 관련 테스트와 빌드만 실행한다.

---

### Task 1: 회의록 제목 selector와 후보 표시

**Files:**
- Modify: `apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts`
- Modify: `apps/app-server/src/modules/agent/tools/meeting-agent-resource-resolver.service.ts`
- Modify: `apps/app-server/src/modules/meeting/meeting.service.ts`
- Test: `apps/app-server/scripts/agent/meeting-tools.test.mjs`
- Test: `apps/app-server/scripts/meeting/test.mjs`

**Interfaces:**
- Consumes: 기존 `MeetingReportSelectorInput`, `MeetingAgentReportSelector`, `listReportsForAgent`
- Produces: `reportTitle?: string` selector와 정확 일치 필터

- [ ] **Step 1: 실패 테스트 작성**

  `summarize_meeting_report`가 `reportTitle: "백엔드 회의"`를 resolver query에 전달하는 테스트, 후보 label이 report title인 테스트, SQL이 `COALESCE(user_title, title)`을 정규화해 정확히 비교하는 테스트를 추가한다.

- [ ] **Step 2: RED 확인**

  Run: `npm.cmd run build && node scripts/agent/meeting-tools.test.mjs`

  Expected: `reportTitle` 미지원 또는 후보 label 불일치로 FAIL.

- [ ] **Step 3: 최소 구현**

  Tool schema·validator·selector 전달 경로에 `reportTitle`을 추가한다. Meeting Agent 조회에 정규화된 표시 제목 exact filter를 추가하고 후보 label을 `report.title`로 변경한다.

- [ ] **Step 4: GREEN 확인**

  Run: `npm.cmd run build && node scripts/agent/meeting-tools.test.mjs && node scripts/meeting/test.mjs`

  Expected: exit code 0.

- [ ] **Step 5: 변경 범위 확인 및 커밋**

  `git diff --check`, `git status --short`, 대상 파일 diff를 확인하고 의도한 파일만 커밋한다.
