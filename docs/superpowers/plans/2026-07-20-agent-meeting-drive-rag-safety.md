# Agent Meeting·Drive RAG 안정화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meeting·Drive 검색이 threshold를 통과한 최신 자료만 근거로 사용하고, embedding timeout과 자료 없음 및 citation 오류를 안전하게 구분하게 한다.

**Architecture:** App Server에 Agent-owned query embedding·relevance policy와 server-only grounding source 경계를 둔다. Meeting·Drive adapter는 threshold를 통과한 source candidate만 실행 계층에 전달하고, grounded-answer outbox는 opaque citation registry를 보존한다. Python Worker는 명시적 embedding timeout과 3회 색인 시도, grounded answer citation 1회 재생성을 담당한다.

**Tech Stack:** NestJS, TypeScript, PostgreSQL/pgvector, Node.js assert scripts, Python 3, OpenAI SDK, pytest, Terraform

## Global Constraints

- Issue #1558 전체를 하나의 branch와 PR로 구현한다.
- 검색은 정확도 우선이며 threshold 미달 source는 boost·dedupe·diversity 이전에 제거한다.
- Meeting과 Drive는 별도 server-owned threshold를 사용한다.
- query embedding timeout은 10초, indexing embedding timeout은 호출당 30초다.
- 색인 시도는 최초 호출 포함 최대 3회다.
- `no_relevant_sources`와 `embedding_temporarily_unavailable`을 구분한다.
- score는 내부 tool/step 진단에만 보존하고 Frontend에는 숫자로 렌더링하지 않는다.
- source가 있는 일반 답변은 유효 citation을 최소 1개 포함해야 한다.
- citation 누락·unknown ID는 같은 source로 1회만 재생성한 뒤 실패한다.
- 실제 Workspace 자료를 relevance fixture에 사용하지 않는다.
- DB migration을 추가하지 않는다. 필요성이 발견되면 구현을 멈추고 사용자에게 알린다.
- 전체 suite를 실행하지 않는다. 각 task의 관련 테스트와 마지막 최소 검증만 실행한다.

---

### Task 1: Query embedding과 relevance policy 경계

**Files:**
- Create: `apps/app-server/src/modules/agent/grounding/query-embedding.ts`
- Create: `apps/app-server/src/modules/agent/grounding/relevance-policy.ts`
- Create: `apps/app-server/scripts/agent/fixtures/rag-relevance-evaluation.json`
- Create: `apps/app-server/scripts/agent/rag-relevance-evaluation.mjs`
- Modify: `apps/app-server/scripts/agent/drive-tools.test.mjs`
- Modify: `apps/app-server/scripts/agent/meeting-evidence-rag.test.mjs`

**Interfaces:**
- Produces: `embedGroundingQuery(query: string): Promise<number[]>`
- Produces: `EmbeddingTemporarilyUnavailableError`, `InvalidEmbeddingResponseError`
- Produces: `meetingRagMinimumSimilarity(): number`, `driveRagMinimumSimilarity(): number`
- Produces: `passesRelevanceThreshold(score: number, threshold: number): boolean`
- Consumes: `OPENAI_API_KEY`, `OPENAI_QUERY_EMBEDDING_TIMEOUT_MS`, `MEETING_RAG_MIN_SIMILARITY`, `DRIVE_RAG_MIN_SIMILARITY`

- [ ] **Step 1: query timeout과 threshold validation 실패 테스트를 작성한다.**

```js
process.env.MEETING_RAG_MIN_SIMILARITY = "1.2";
assert.throws(() => meetingRagMinimumSimilarity(), /between 0 and 1/);

globalThis.fetch = async () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  throw error;
};
await assert.rejects(
  () => embedGroundingQuery("배포 구조"),
  (error) => error.code === "EMBEDDING_TEMPORARILY_UNAVAILABLE"
);
```

- [ ] **Step 2: 두 App Server 스크립트를 실행해 helper 미존재 RED를 확인한다.**

Run: `node scripts/agent/meeting-evidence-rag.test.mjs`

Run: `node scripts/agent/drive-tools.test.mjs`

Expected: query embedding/relevance export 또는 timeout assertion 실패

- [ ] **Step 3: shared query embedding helper를 구현한다.**

```ts
export class EmbeddingTemporarilyUnavailableError extends Error {
  readonly code = "EMBEDDING_TEMPORARILY_UNAVAILABLE";
}

export async function embedGroundingQuery(query: string): Promise<number[]> {
  const timeoutMs = positiveIntegerEnvironment(
    "OPENAI_QUERY_EMBEDDING_TIMEOUT_MS",
    10_000
  );
  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: embeddingHeaders(),
      body: embeddingBody(query)
    });
    return await parseEmbeddingResponse(response);
  } catch (error) {
    if (isRetryableEmbeddingFailure(error)) {
      throw new EmbeddingTemporarilyUnavailableError(
        "자료 검색이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
      );
    }
    throw error;
  }
}
```

- [ ] **Step 4: strict threshold parser와 threshold-first predicate를 구현한다.**

```ts
function similarityEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return value;
}

export const passesRelevanceThreshold = (score: number, threshold: number) =>
  Number.isFinite(score) && score >= threshold;

export const meetingRagMinimumSimilarity = () =>
  similarityEnvironment("MEETING_RAG_MIN_SIMILARITY", 0.55);
export const driveRagMinimumSimilarity = () =>
  similarityEnvironment("DRIVE_RAG_MIN_SIMILARITY", 0.58);
```

- [ ] **Step 5: 가상 한국어 relevance fixture와 명시적 평가 스크립트를 작성한다.**

```json
{
  "meeting": [
    {
      "query": "파일 저장소를 무엇으로 결정했나요?",
      "candidate": "파일 저장소는 Cloudflare R2를 사용하기로 결정했습니다.",
      "label": "relevant"
    },
    {
      "query": "파일 저장소를 무엇으로 결정했나요?",
      "candidate": "다음 데일리 스크럼은 오전 10시에 진행합니다.",
      "label": "irrelevant"
    }
  ],
  "drive": [
    {
      "query": "Worker 배포 순서를 알려줘",
      "candidate": "App Server 배포 후 Worker를 배포하고 rollback 호환성을 확인합니다.",
      "label": "relevant"
    },
    {
      "query": "Worker 배포 순서를 알려줘",
      "candidate": "브랜드 컬러와 로고 사용 규칙을 정리했습니다.",
      "label": "irrelevant"
    }
  ]
}
```

평가 스크립트는 각 domain의 `maxIrrelevantScore`보다 0.01 큰 값을 소수 둘째 자리로
올림해 `suggestedThreshold`로 출력한다. 관련 fixture가 하나도 통과하지 않거나 점수
범위가 겹쳐 precision-first 기준을 만들 수 없으면 exit 1로 종료한다.

- [ ] **Step 6: App Server 관련 테스트를 GREEN으로 확인한다.**

Run: `node scripts/agent/meeting-evidence-rag.test.mjs`

Run: `node scripts/agent/drive-tools.test.mjs`

Expected: exit 0

- [ ] **Step 7: Task 1을 커밋한다.**

```bash
git add apps/app-server/src/modules/agent/grounding apps/app-server/scripts/agent
git commit -m "feat: RAG embedding과 관련도 정책 경계 추가 (#1558)"
```

### Task 2: Meeting threshold-first retrieval과 현재 index 제한

**Files:**
- Modify: `apps/app-server/src/modules/meeting/meeting-transcript-rag.service.ts`
- Modify: `apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts`
- Modify: `apps/app-server/scripts/agent/meeting-evidence-rag.test.mjs`
- Modify: `apps/app-server/scripts/agent/meeting-tools.test.mjs`

**Interfaces:**
- Consumes: `embedGroundingQuery`, `meetingRagMinimumSimilarity`, `passesRelevanceThreshold`
- Produces: `MeetingEvidenceSource.score: number`
- Produces: server-only Meeting grounding candidates from `search_meeting_transcript`

- [ ] **Step 1: threshold 이전 boost 금지와 source type 비강제 테스트를 작성한다.**

```js
const sources = await service.search(USER_ID, WORKSPACE_ID, { query: "배포" });
assert.deepEqual(
  sources.map((source) => source.sourceId),
  [`transcript:${RELEVANT_TRANSCRIPT_ID}`]
);
assert.equal(
  sources.some((source) => source.sourceId === `activity:${LOW_SCORE_DIRECT_ID}`),
  false
);
```

Fake DB에는 threshold 위 transcript, threshold 아래 `directly_referenced` activity,
threshold 아래 일반 activity를 넣는다. activity 대표가 강제로 선택되지 않는지 확인한다.

- [ ] **Step 2: Meeting RAG 스크립트를 실행해 RED를 확인한다.**

Run: `node scripts/agent/meeting-evidence-rag.test.mjs`

Expected: threshold 미달 directly referenced source가 결과에 남아 assertion 실패

- [ ] **Step 3: Meeting SQL을 현재 완료 index와 similarity score 중심으로 바꾼다.**

```sql
JOIN LATERAL (
  SELECT job.transcript_hash, job.status
  FROM meeting_report_transcript_embedding_jobs AS job
  WHERE job.meeting_report_id = chunk.meeting_report_id
  ORDER BY job.created_at DESC, job.id DESC
  LIMIT 1
) AS current_job
  ON current_job.status = 'completed'
 AND current_job.transcript_hash = chunk.transcript_hash
```

activity query도 최신 `evidence_hash` job이 `completed`인 chunk만 읽는다. 두 query는
`1 - cosine distance AS score`를 반환하고 각 source type별 후보를 최대 20개 읽는다.

- [ ] **Step 4: threshold를 selection 첫 단계에 적용한다.**

```ts
const eligible = candidates.filter((candidate) =>
  passesRelevanceThreshold(candidate.score, meetingRagMinimumSimilarity())
);
const duplicatePairs = await this.findSemanticDuplicatePairs(
  eligible.filter(isTranscript).map(sourceUuid),
  eligible.filter(isActivity).map(sourceUuid)
);
return this.selectSources(eligible, duplicatePairs);
```

`directlyReferenced` boost와 source type representative selection은 `eligible` 안에서만
실행한다. 최종 source에는 내부 `score`를 유지한다.

- [ ] **Step 5: Meeting tool이 source candidate를 server-only 결과로 전달한다.**

```ts
return {
  outputSummary: {
    groundingOutcome: sources.length ? "sources_found" : "no_relevant_sources",
    sourceCount: sources.length,
    sourceTypes
  },
  groundingSources: sources.map((source) => this.toGroundingCandidate(source)),
  resourceRefs: this.reportResourceRefs(sources, reportId),
  status: "completed"
};
```

- [ ] **Step 6: Meeting 관련 스크립트를 GREEN으로 확인한다.**

Run: `node scripts/agent/meeting-evidence-rag.test.mjs`

Run: `node scripts/agent/meeting-tools.test.mjs`

Expected: exit 0

- [ ] **Step 7: Task 2를 커밋한다.**

```bash
git add apps/app-server/src/modules/meeting apps/app-server/src/modules/agent/tools/meeting-agent-tools.service.ts apps/app-server/scripts/agent/meeting-evidence-rag.test.mjs apps/app-server/scripts/agent/meeting-tools.test.mjs
git commit -m "fix: Meeting 근거 검색에 threshold 우선 적용 (#1558)"
```

### Task 3: Drive threshold·chunk citation과 grounded answer 연결

**Files:**
- Modify: `apps/app-server/src/modules/drive/document-search.service.ts`
- Modify: `apps/app-server/src/modules/agent/tools/drive-agent-tools.service.ts`
- Modify: `apps/app-server/src/modules/agent/types/agent-tool.types.ts`
- Modify: `apps/app-server/src/modules/agent/agent-execution.service.ts`
- Modify: `apps/app-server/scripts/agent/drive-tools.test.mjs`
- Modify: `apps/app-server/scripts/agent/execution.test.mjs`

**Interfaces:**
- Consumes: `embedGroundingQuery`, `driveRagMinimumSimilarity`, `passesRelevanceThreshold`
- Produces: `AgentGroundingSourceCandidate`
- Produces: `DocumentSearchResult.chunkId`, `DocumentSearchResult.score`
- Produces: `DocumentSearchService.loadAuthorizedSources(userId, workspaceId, sourceRefs)`

- [ ] **Step 1: Drive threshold·latest snapshot·grounding 경계 실패 테스트를 작성한다.**

```js
assert.equal(tool.requiresGroundedAnswer, true);
const result = await tool.execute(context, tool.validateInput({ query: "rollback" }));
assert.equal(result.outputSummary.sourceCount, 1);
assert.equal(result.groundingSources.length, 1);
assert.equal(result.groundingSources[0].sourceType, "drive_document");
assert.equal(result.outputSummary.documents, undefined);
```

- [ ] **Step 2: Drive와 execution 스크립트를 실행해 RED를 확인한다.**

Run: `node scripts/agent/drive-tools.test.mjs`

Run: `node scripts/agent/execution.test.mjs`

Expected: `requiresGroundedAnswer` 또는 `groundingSources` assertion 실패

- [ ] **Step 3: server-only grounding candidate type을 추가한다.**

```ts
export interface AgentGroundingSourceCandidate {
  sourceType: "meeting_transcript" | "meeting_activity" | "drive_document";
  sourceRef: string;
  title?: string;
  excerpt: string;
  score: number;
  resourceRef: AgentResourceRef;
}

export interface AgentToolExecutionResult {
  outputSummary: AgentToolOutputSummary;
  resourceRefs: AgentResourceRef[];
  status: string;
  groundingSources?: AgentGroundingSourceCandidate[];
}
```

`AgentExecutionService`는 `groundingSources`를 `AgentGroundedAnswerService`에 직접 넘기고
public `outputSummary`에는 raw `sourceRef`를 복제하지 않는다.

- [ ] **Step 4: Drive search에서 threshold 미달 chunk를 제거한다.**

```ts
const rows = await this.rankCurrentSnapshotChunks(workspaceId, vector, candidateLimit);
return rows
  .map(this.mapSearchRow)
  .filter((result) =>
    passesRelevanceThreshold(result.score, driveRagMinimumSimilarity())
  )
  .slice(0, input.topK);
```

SQL은 `chunk.id AS chunk_id`를 반환하고 기존 `document.latest_snapshot_id =
chunk.snapshot_id` 조건을 유지한다. 최종 결과는 문서당 관련도가 가장 높은 chunk 하나만
남긴다.

- [ ] **Step 5: Drive source 완료 시점 재검증 loader를 구현한다.**

```ts
async loadAuthorizedSources(
  currentUserId: string,
  workspaceId: string,
  sourceRefs: string[]
): Promise<DocumentGroundingSource[]> {
  await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
  return this.loadCurrentActiveChunks(workspaceId, parseDriveChunkRefs(sourceRefs));
}
```

query는 document/item 미삭제, document type, latest snapshot과 chunk snapshot 일치를 다시
검증한다.

- [ ] **Step 6: Drive tool을 grounded answer tool로 전환한다.**

```ts
requiresGroundedAnswer: true,
execute: async (context, input) => {
  const results = await this.documentSearchService.search(...);
  return {
    outputSummary: {
      groundingOutcome: results.length ? "sources_found" : "no_relevant_sources",
      sourceCount: results.length,
      sourceTypes: results.length ? ["drive_document"] : []
    },
    groundingSources: results.map(toDriveGroundingCandidate),
    resourceRefs: results.map(toResourceRef),
    status: "completed"
  };
}
```

- [ ] **Step 7: Drive와 execution 스크립트를 GREEN으로 확인한다.**

Run: `node scripts/agent/drive-tools.test.mjs`

Run: `node scripts/agent/execution.test.mjs`

Expected: exit 0

- [ ] **Step 8: Task 3을 커밋한다.**

```bash
git add apps/app-server/src/modules/drive apps/app-server/src/modules/agent apps/app-server/scripts/agent/drive-tools.test.mjs apps/app-server/scripts/agent/execution.test.mjs
git commit -m "feat: Drive 검색을 안전한 grounded source로 연결 (#1558)"
```

### Task 4: Opaque citation registry와 no-source short circuit

**Files:**
- Modify: `apps/app-server/src/modules/agent/agent-grounded-answer.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent-internal.controller.ts`
- Modify: `apps/app-server/scripts/agent/meeting-evidence-rag.test.mjs`
- Modify: `apps/app-server/scripts/agent/execution.test.mjs`

**Interfaces:**
- Consumes: `AgentGroundingSourceCandidate[]`
- Produces: `GroundingCitationRegistryEntry`
- Produces: internal `GET grounding-context` response sources with `citationId`
- Produces: `completeSecurityRefusal(runId)`, `failCitationValidation(runId)`

- [ ] **Step 1: no-source 미발행과 citation registry 실패 테스트를 작성한다.**

```js
await service.completeToolAndQueue({ ...baseInput, groundingSources: [] });
assert.equal(database.insertedGroundedOutboxRows.length, 0);
assert.match(database.completedRun.finalAnswer, /관련된 근거를 찾지 못했습니다/);

await assert.rejects(
  () => service.complete(RUN_ID, "답변", []),
  /citation is required/
);
```

registry에는 `citationId`, `sourceType`, `sourceRef`, bounded `resourceRef`만 저장되고
score·excerpt는 저장된 tool step 범위 밖으로 복제하지 않는지 확인한다.

- [ ] **Step 2: Meeting RAG와 execution 스크립트를 실행해 RED를 확인한다.**

Run: `node scripts/agent/meeting-evidence-rag.test.mjs`

Run: `node scripts/agent/execution.test.mjs`

Expected: no-source outbox가 생성되거나 빈 citation이 허용되어 실패

- [ ] **Step 3: opaque citation registry를 기존 JSONB column에 저장한다.**

```ts
interface GroundingCitationRegistryEntry {
  citationId: string;
  sourceType: AgentGroundingSourceCandidate["sourceType"];
  sourceRef: string;
  resourceRef: AgentResourceRef;
}

const registry = groundingSources.map((source) => ({
  citationId: `citation_${randomUUID()}`,
  sourceType: source.sourceType,
  sourceRef: source.sourceRef,
  resourceRef: source.resourceRef
}));
```

`agent_grounded_answer_outbox.source_ids` JSON array에 registry object를 저장한다. parser는
legacy Meeting string array도 계속 읽고 registry로 정규화한다.

- [ ] **Step 4: source type별 재검증과 bounded Worker context를 구현한다.**

```ts
const sources = await Promise.all(
  registry.map((entry) => this.loadAuthorizedRegistrySource(userId, workspaceId, entry))
);
return {
  prompt,
  sources: sources.filter(isPresent).map((source) => ({
    citationId: source.citationId,
    sourceType: source.sourceType,
    title: source.title,
    excerpt: source.excerpt,
    resourceRef: source.resourceRef
  }))
};
```

Meeting은 report participant/owner 권한, Drive는 최신 active snapshot을 다시 검증한다.

- [ ] **Step 5: source 0건은 LLM outbox 없이 결정적으로 완료한다.**

```ts
const NO_RELEVANT_SOURCES_MESSAGE =
  "현재 접근 가능한 회의록과 문서에서 질문과 관련된 근거를 찾지 못했습니다. " +
  "대상을 조금 더 구체적으로 입력해 주세요.";
```

tool step과 run을 같은 transaction에서 completed로 만들고 answer step/outbox는 생성하지
않는다.

- [ ] **Step 6: normal·security·citation-failure 완료 경계를 분리한다.**

```ts
async complete(runId: string, answer: string, citations: string[]): Promise<void> {
  const allowed = await this.allowedCitationIds(runId);
  if (citations.length === 0) throw new Error("Grounded answer citation is required");
  if (citations.some((id) => !allowed.has(id))) {
    throw new Error("Grounded answer contains an unknown citation");
  }
  await this.completeGroundedRun(runId, answer, citations);
}
```

내부 controller에 server-owned 보안 거절과 2차 citation 실패를 처리하는 별도 endpoint를
추가한다. 보안 거절 문구는 Worker가 보내지 않고 App Server 상수를 사용한다.

- [ ] **Step 7: App Server 관련 스크립트를 GREEN으로 확인한다.**

Run: `node scripts/agent/meeting-evidence-rag.test.mjs`

Run: `node scripts/agent/execution.test.mjs`

Expected: exit 0

- [ ] **Step 8: Task 4를 커밋한다.**

```bash
git add apps/app-server/src/modules/agent apps/app-server/scripts/agent/meeting-evidence-rag.test.mjs apps/app-server/scripts/agent/execution.test.mjs
git commit -m "fix: grounded answer citation 계약 강화 (#1558)"
```

### Task 5: Grounded answer citation 1회 재생성

**Files:**
- Modify: `apps/ai-worker/app/agent_processor.py`
- Modify: `apps/ai-worker/app/meeting_report_runtime.py`
- Modify: `apps/ai-worker/tests/test_agent_processor.py`

**Interfaces:**
- Consumes: grounding context `sources[].citationId`
- Consumes: internal security-refusal/citation-failure endpoints
- Produces: 최대 2회의 `_answer` 호출과 strict citation allow-list

- [ ] **Step 1: citation 누락·unknown ID·2차 실패 테스트를 작성한다.**

```python
processor = FakeGroundedAnswerProcessor(
    answers=[("초안", []), ("수정 답변", ["citation_valid"])]
)
result = processor.process({"jobType": "agent_grounded_answer_requested", "runId": RUN_ID})
assert result.reason == "grounded_answer_completed"
assert processor.answer_calls == 2

processor = FakeGroundedAnswerProcessor(
    answers=[("초안", ["citation_unknown"]), ("재시도", [])]
)
result = processor.process(job)
assert result.reason == "grounded_answer_citation_failed"
assert handoff.citation_failure_calls == [RUN_ID]
```

- [ ] **Step 2: targeted Agent processor 테스트를 실행해 RED를 확인한다.**

Run: `python -m pytest tests/test_agent_processor.py -k grounded_answer -q`

Expected: answer call이 1회이거나 invalid citation이 handoff되어 실패

- [ ] **Step 3: Worker citation validation과 1회 재생성을 구현한다.**

```python
allowed = {
    source["citationId"]
    for source in safe_sources
    if isinstance(source.get("citationId"), str)
}
for attempt in range(2):
    answer, citations = self._answer(prompt, safe_sources)
    normalized = list(dict.fromkeys(citations))
    if normalized and set(normalized).issubset(allowed):
        self.handoff_client.complete_grounded_answer(run_id, answer, normalized)
        return AgentProcessResult(True, "grounded_answer_completed", run_id)
self.handoff_client.fail_grounded_answer_citations(run_id)
return AgentProcessResult(True, "grounded_answer_citation_failed", run_id)
```

두 번째 `_answer` system prompt에는 첫 응답의 원문을 넣지 않고 제공된 `citationId` 중
최소 1개만 사용하라는 retry instruction만 추가한다.

- [ ] **Step 4: prompt를 Meeting·Drive 공통 bounded source 계약으로 바꾼다.**

system prompt는 `meeting_transcript`, `meeting_activity`, `drive_document`를 구분하고 각
claim에 제공된 citation만 사용하도록 한다. security 검사 실패는 별도 server-owned
security refusal endpoint를 호출한다.

- [ ] **Step 5: targeted Agent processor 테스트를 GREEN으로 확인한다.**

Run: `python -m pytest tests/test_agent_processor.py -k grounded_answer -q`

Expected: pass

- [ ] **Step 6: Task 5를 커밋한다.**

```bash
git add apps/ai-worker/app/agent_processor.py apps/ai-worker/app/meeting_report_runtime.py apps/ai-worker/tests/test_agent_processor.py
git commit -m "fix: grounded answer citation 재생성 제한 (#1558)"
```

### Task 6: Meeting·Drive indexing embedding timeout과 재시도

**Files:**
- Create: `apps/ai-worker/app/embedding_failure.py`
- Modify: `apps/ai-worker/app/meeting_transcript_embedding_processor.py`
- Modify: `apps/ai-worker/app/meeting_activity_evidence_embedding_processor.py`
- Modify: `apps/ai-worker/app/meeting_report_runtime.py`
- Modify: `apps/ai-worker/app/shared_ai_worker_runtime.py`
- Modify: `apps/ai-worker/app/workspace_indexing_worker_runtime.py`
- Modify: `apps/ai-worker/tests/test_meeting_transcript_embedding_processor.py`
- Modify: `apps/ai-worker/tests/test_meeting_activity_evidence_embedding_processor.py`
- Modify: `apps/ai-worker/tests/test_workspace_indexing_worker.py`

**Interfaces:**
- Produces: `RetryableEmbeddingError`, `TerminalEmbeddingError`
- Consumes: `OPENAI_INDEXING_EMBEDDING_TIMEOUT_SECONDS`, default `30.0`
- Produces: Meeting repository `requeue_*_embedding_job(job_id, message)`

- [ ] **Step 1: timeout retry·3회 소진·terminal vector 테스트를 작성한다.**

```python
repository = FakeTranscriptRepository(job={"id": JOB_ID, "attempt_count": 1})
processor = MeetingTranscriptEmbeddingProcessor(repository, TimeoutEmbedder())
assert processor.process_next() == "meeting_transcript_embedding_retryable_failure"
assert repository.requeued == [JOB_ID]

repository = FakeTranscriptRepository(job={"id": JOB_ID, "attempt_count": 3})
processor = MeetingTranscriptEmbeddingProcessor(repository, TimeoutEmbedder())
assert processor.process_next() == "meeting_transcript_embedding_retry_exhausted"
assert repository.failed == [JOB_ID]
```

동일 패턴을 activity evidence와 Drive document processor에 적용하고 malformed vector는
즉시 terminal인지 확인한다.

- [ ] **Step 2: 세 Worker 테스트 파일을 실행해 RED를 확인한다.**

Run: `python -m pytest tests/test_meeting_transcript_embedding_processor.py tests/test_meeting_activity_evidence_embedding_processor.py tests/test_workspace_indexing_worker.py -q`

Expected: timeout이 terminal 처리되거나 settings field가 없어 실패

- [ ] **Step 3: 공통 embedding failure 분류를 구현한다.**

```python
class RetryableEmbeddingError(Exception):
    pass

class TerminalEmbeddingError(Exception):
    pass

def classify_openai_embedding_error(error: Exception) -> Exception:
    if is_timeout_connection_rate_limit_or_5xx(error):
        return RetryableEmbeddingError("OpenAI embedding is temporarily unavailable")
    return TerminalEmbeddingError("OpenAI embedding failed")
```

provider raw response와 source text는 exception message에 포함하지 않는다.

- [ ] **Step 4: Python OpenAI client에 30초 timeout을 주입한다.**

```python
self.client = OpenAI(api_key=api_key, timeout=timeout_seconds)
```

Meeting shared/legacy runtime과 Workspace Indexing settings가
`OPENAI_INDEXING_EMBEDDING_TIMEOUT_SECONDS`를 positive float로 읽고 모든 embedder 생성에
전달한다.

- [ ] **Step 5: Meeting DB job requeue와 attempt 3회 제한을 구현한다.**

```sql
UPDATE meeting_report_transcript_embedding_jobs
SET status = 'pending', error_message = %s, locked_at = NULL
WHERE id = %s
  AND status = 'processing'
  AND attempt_count < 3
```

activity evidence job에도 같은 requeue를 추가한다. processor는 retryable error에서 현재
`attempt_count`가 3 이상이면 `failed`, 미만이면 `pending`으로 돌린다.

- [ ] **Step 6: Drive의 기존 SQS retry를 typed failure 기준으로 제한한다.**

`RetryableEmbeddingError`만 message를 남겨 SQS redelivery를 허용한다. 빈 입력,
response count/dimension/non-finite vector는 `TerminalEmbeddingError`로 message를 삭제하고
job을 failed로 만든다. 기존 `ApproximateReceiveCount >= 3` exhaustion 동작은 유지한다.

- [ ] **Step 7: 세 Worker 테스트 파일을 GREEN으로 확인한다.**

Run: `python -m pytest tests/test_meeting_transcript_embedding_processor.py tests/test_meeting_activity_evidence_embedding_processor.py tests/test_workspace_indexing_worker.py -q`

Expected: pass

- [ ] **Step 8: Task 6을 커밋한다.**

```bash
git add apps/ai-worker/app apps/ai-worker/tests/test_meeting_transcript_embedding_processor.py apps/ai-worker/tests/test_meeting_activity_evidence_embedding_processor.py apps/ai-worker/tests/test_workspace_indexing_worker.py
git commit -m "fix: Meeting·Drive embedding timeout과 재시도 추가 (#1558)"
```

### Task 7: 평가값·Infra·API 문서와 최소 통합 검증

**Files:**
- Modify: `infra/envs/dev/main.tf`
- Modify: `docs/api/agent-api.md`
- Modify: `docs/api/meeting-api.md`
- Modify: `docs/api/drive-api.md`
- Modify: `docs/superpowers/plans/2026-07-20-agent-meeting-drive-rag-safety.md`

**Interfaces:**
- Consumes: Task 1 relevance evaluation의 Meeting·Drive `suggestedThreshold`
- Produces: dev ECS timeout·threshold 환경 설정
- Produces: 최종 public/internal Agent·Meeting·Drive 계약 문서

- [ ] **Step 1: relevance 평가 스크립트를 명시적으로 실행한다.**

Run: `node scripts/agent/rag-relevance-evaluation.mjs`

Expected: domain별 `maxIrrelevantScore`, `relevantRecall`, `suggestedThreshold`를 출력하고
exit 0. `OPENAI_API_KEY`가 없거나 precision-first 분리가 불가능하거나 Meeting 0.55와
Drive 0.58이 무관 fixture를 하나라도 통과시키면 값을 추측하지 않고 작업을 멈춰
사용자에게 알린다.

- [ ] **Step 2: 평가 결과를 code default와 dev 환경변수에 동일하게 반영한다.**

```hcl
OPENAI_QUERY_EMBEDDING_TIMEOUT_MS          = "10000"
MEETING_RAG_MIN_SIMILARITY                 = "0.55"
DRIVE_RAG_MIN_SIMILARITY                   = "0.58"
OPENAI_INDEXING_EMBEDDING_TIMEOUT_SECONDS  = "30"
```

0.55/0.58은 Step 1에서 무관 fixture 0건 통과를 확인한 경우에만 확정한다. 평가가 이를
지지하지 않으면 이 step을 진행하지 않는다. App Server, shared AI Worker, Workspace
Indexing Worker 중 해당 값을 소비하는 ECS task에만 넣는다.

- [ ] **Step 3: API 문서를 실제 계약에 맞춰 갱신한다.**

문서에는 threshold-first 순서, score 비표시, `sources_found | no_relevant_sources`, query
timeout 재시도 안내, opaque citation allow-list, citation 최소 1개와 1회 재생성, worker
30초/3회 시도, Drive 최신 snapshot과 Meeting 최신 완료 hash 제한을 명시한다.

- [ ] **Step 4: 관련 App Server 최소 검증을 실행한다.**

Run: `npm.cmd run build`

Run: `node scripts/agent/meeting-evidence-rag.test.mjs`

Run: `node scripts/agent/drive-tools.test.mjs`

Run: `node scripts/agent/execution.test.mjs`

Expected: 모두 exit 0

- [ ] **Step 5: 관련 AI Worker 최소 검증을 실행한다.**

Run: `python -m pytest tests/test_agent_processor.py -k grounded_answer -q`

Run: `python -m pytest tests/test_meeting_transcript_embedding_processor.py tests/test_meeting_activity_evidence_embedding_processor.py tests/test_workspace_indexing_worker.py -q`

Expected: 모두 pass

- [ ] **Step 6: 변경한 Terraform만 formatting 확인한다.**

Run: `terraform fmt -check infra/envs/dev/main.tf`

Expected: exit 0. 실패하면 `terraform fmt infra/envs/dev/main.tf` 후 한 번만 다시 확인한다.

- [ ] **Step 7: diff와 migration 부재를 확인한다.**

Run: `git diff --check origin/dev...HEAD`

Run: `git diff --name-only origin/dev...HEAD -- db/migrations`

Expected: whitespace 오류 없음, migration 경로 출력 없음

- [ ] **Step 8: Task 7을 커밋한다.**

```bash
git add infra/envs/dev/main.tf docs/api docs/superpowers/plans/2026-07-20-agent-meeting-drive-rag-safety.md
git commit -m "docs: RAG 안정화 배포와 API 계약 반영 (#1558)"
```
