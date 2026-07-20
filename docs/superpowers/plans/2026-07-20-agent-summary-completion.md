# Agent Meeting Summary Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 완료된 회의록 요약 결과를 Planner가 즉시 최종 답변으로 반환하도록 workflow 완료 판정을 바로잡는다.

**Architecture:** `meeting.report.summary`에서 선택적인 목록 조회를 필수 chain으로 모델링하지 않고 실제 요약 Tool만 등록한다. Worker 공통 완료 판정과 필수 mutation chain은 유지한다.

**Tech Stack:** Python 3.12, pytest, Black, Ruff

## Global Constraints

- API와 DB 계약을 변경하지 않는다.
- 기존 필수 mutation chain의 Tool 순서를 변경하지 않는다.
- 실제 회의록 데이터 대신 테스트 fixture만 사용한다.

---

### Task 1: 회의록 요약 capability 회귀 테스트

**Files:**
- Modify: `apps/app-server/scripts/agent/agent-job.test.mjs`

**Interfaces:**
- Consumes: `AgentToolRegistryService`의 capability catalog
- Produces: `meeting.report.summary`가 요약 Tool만 포함함을 검증하는 테스트

- [ ] **Step 1: 실패 테스트 작성**

  `meeting.report.summary`의 `toolNames`가
  `["summarize_meeting_report"]`인지 검증한다. 필수 mutation chain인
  `meeting.action_items.transfer_and_approve`의 기존 assertion은 유지한다.

- [ ] **Step 2: 실패 확인**

  Run:
  `npm run build && node scripts/agent/agent-job.test.mjs`

  Expected: 현재 catalog에 `list_meeting_reports`가 포함되어 assertion이 실패한다.

### Task 2: 요약 capability와 파생 snapshot 수정

**Files:**
- Modify: `apps/app-server/src/modules/agent/agent-tool-capability-catalog.ts`
- Modify: `apps/app-server/scripts/agent/agent-job.test.mjs`
- Modify: `apps/ai-worker/evals/tool_retrieval_quality_gate_v1.json`
- Modify: `apps/ai-worker/tests/test_agent_tool_quality_gate.py`
- Test: `apps/app-server/scripts/agent/agent-job.test.mjs`

**Interfaces:**
- Consumes: `AgentCapabilityDefinition.toolNames`
- Produces: 갱신된 registry inventory와 quality gate snapshot

- [ ] **Step 1: 최소 구현**

  `meeting.report.summary`의 `toolNames`를
  `["summarize_meeting_report"]`로 변경한다.

- [ ] **Step 2: 회귀 테스트 통과 확인**

  App Server exporter로 registry snapshot을 생성하고 inventory/catalog 해시 및 AI
  Worker quality fixture를 새 snapshot과 동기화한다.

- [ ] **Step 3: 관련 파일 품질 검증**

  Run:
  `npm run format:check && npm run lint && npm test && npm run build`

  Run:
  `python -m pytest tests/test_agent_tool_quality_gate.py -q`

  Run:
  `python scripts/check_tool_retrieval_quality_gate.py --registry-snapshot <snapshot> --output <output>`

  Expected: 모두 exit code 0.

### Task 3: 게시

**Files:**
- Modify: 위 Task의 코드, 테스트 및 설계 문서

**Interfaces:**
- Consumes: 검증된 git diff
- Produces: `dev` 대상 GitHub Pull Request

- [ ] **Step 1: diff와 테스트 결과 확인**

  `git diff --check`와 `git status --short`로 의도한 파일만 변경됐는지 확인한다.

- [ ] **Step 2: 커밋 및 푸시**

  변경 파일만 명시적으로 stage하고 한국어 convention에 맞춰 커밋한 뒤 원격
  `codex/fix-agent-summary-completion` 브랜치로 push한다.

- [ ] **Step 3: PR 생성**

  `dev`를 base로 원인, 수정 내용, 검증 결과가 포함된 ready PR을 생성한다.
