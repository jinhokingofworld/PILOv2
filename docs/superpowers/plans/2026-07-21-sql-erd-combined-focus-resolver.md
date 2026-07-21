# SQLtoERD Combined Focus Resolver Implementation Plan

> **For Codex:** Execute this plan task-by-task with test-first changes and fresh verification before publishing.

**Goal:** Replace the public inspect-then-focus Agent chain with one focus tool that resolves the current SQLtoERD session server-side and safely returns a focus resource or clarification.

**Architecture:** App Server owns session inspection, deterministic matching, optional bounded LLM fallback, FK expansion, and execution-time revision validation. AI Worker only selects `focus_sql_erd_tables` with a natural-language `featureQuery`. Existing focus resource metadata remains unchanged.

**Tech Stack:** NestJS/TypeScript, Python Agent worker, OpenAI Responses API strict JSON schema, Node/Python script tests.

---

### Task 1: Lock the public focus contract with failing App Server tests

**Files:**
- Modify: `apps/app-server/scripts/agent/sql-erd-tools.test.mjs`
- Modify: `apps/app-server/scripts/agent/execution.test.mjs`

1. Assert that the SQLtoERD adapter no longer lists `inspect_sql_erd_schema`.
2. Assert that focus accepts only `featureQuery` and requires SQLtoERD surface context.
3. Add exact-match, LLM-fallback, ambiguity, invalid-ref, provider-failure, and stale-session cases.
4. Run the focused scripts and confirm they fail for the expected old contract.

### Task 2: Implement server-owned inspection and hybrid resolution

**Files:**
- Create: `apps/app-server/src/modules/agent/tools/sql-erd-table-focus-resolver.ts`
- Modify: `apps/app-server/src/modules/agent/tools/sql-erd-table-focus.ts`
- Modify: `apps/app-server/src/modules/agent/tools/sql-erd-agent-tools.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent-read-result-formatter.ts`

1. Add pure deterministic matching and direct FK expansion helpers.
2. Add bounded strict-schema OpenAI fallback with timeout and safe failure.
3. Make focus load the context session, resolve refs internally, re-fetch, and validate revision/fingerprint before producing a resource.
4. Return formatter-supported clarification without resource creation when resolution is unsafe.
5. Run focused App Server build/tests until green.

### Task 3: Hard-cutover capability catalog and AI Worker

**Files:**
- Modify: `apps/app-server/src/modules/agent/agent-tool-capability-catalog.ts`
- Modify: `apps/ai-worker/app/agent_processor.py`
- Modify: `apps/ai-worker/app/agent_latency.py`
- Modify: `apps/ai-worker/app/meeting_report_runtime.py`
- Modify: relevant `apps/ai-worker/tests/*.py` and `apps/ai-worker/evals/*.json`

1. Write failing retrieval/planner tests for a single focus tool with `featureQuery`.
2. Remove inspect continuation, bypass, prerequisite-output parsing, and inspect-specific prompt rules.
3. Change `sql_erd.inspect` capability to a single focus operation while retaining the existing read flag.
4. Remove inspect-specific latency/output allowances and update fixtures.
5. Run the narrow AI Worker unit/eval tests and format checks.

### Task 4: Remove obsolete client/session-candidate compatibility and update docs

**Files:**
- Modify: `apps/app-server/src/modules/agent/agent.service.ts`
- Modify: `apps/frontend/src/features/agent/resource-links.ts`
- Modify: relevant frontend/app-server tests
- Modify: `docs/api/agent-api.md`
- Modify: `docs/api/sqltoerd-api.md`
- Modify: `docs/infra/agent-sql-erd-latency-observability.md`
- Modify: `docs/AgentToolRecognitionPR1602TestResults.md` only if it describes current behavior

1. Remove inspect-specific candidate resume and resource-link parsing.
2. Preserve generic candidate/context behavior for other domains.
3. Document focus-only input, server-owned validation, LLM fallback boundary, hard cutover, disabled flag rollback, and unsupported inspect-only requests.
4. Update focused regression tests.

### Task 5: Add offline resolver evaluation and verify

**Files:**
- Create or modify: App Server SQLtoERD resolver fixture/test under `apps/app-server/scripts/agent/`

1. Add canonical, held-out, negative, and ambiguous fixtures without raw production SQL or IDs.
2. Compare deterministic/new resolver outputs against expected selections; mock provider fallback.
3. Run App Server build plus SQLtoERD/execution tests, narrow AI Worker tests/evals, frontend Agent tests, and format/type checks for changed packages.
4. Inspect `git diff`, common-area lists, accidental secrets, generated files, and unrelated changes.

### Task 6: Publish

1. Commit with the repository convention and issue number `#1630`.
2. Push `perf/1630-sql-erd-focus-resolver`.
3. Open a ready PR to `dev` with `Closes #1630`, test evidence, existing disabled/read flag behavior, activation conditions, rollback, hard-cutover note, and unsupported scope.
