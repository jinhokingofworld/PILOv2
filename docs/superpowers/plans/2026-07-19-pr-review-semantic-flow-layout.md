# PR Review 의미 Flow 재구성과 리뷰 순서 레이아웃 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 약한 규칙 관계가 Flow를 과병합하지 않도록 AI가 파일을 의미 단위로 재구성하게 하고, PR Review Canvas를 항상 리뷰 순서 1→2→3으로 읽히게 만든다.

**Architecture:** Semantic Graph v1은 롤백 호환 경로로 보존하고 v2에 `locked | hint` 관계와 전역 Flow partition 출력을 추가한다. App Server가 v2 Flow를 먼저 검증한 뒤 relation을 별도로 검증하여 relation 오류만 부분 fallback하고, Canvas rank는 semantic relation이 아닌 `workflowOrder` spine만 사용한다.

**Tech Stack:** NestJS/TypeScript, Python 3.12, OpenAI strict structured output, ELK, Dagre, Node test scripts, pytest

## Global Constraints

- DB schema와 migration은 변경하지 않는다.
- 공개 PR Review response shape는 변경하지 않는다.
- `matching_test_filename`, `package_lock_manifest`만 `locked`이고 `relative_import:*`, `explicit_file_reference`, `shared_identifier:*`는 `hint`다.
- v2는 변경 파일이 있으면 1개 이상 최대 `min(8, changed file count)`개의 Flow를 반환하고 모든 파일을 정확히 한 번 포함한다. 빈 PR은 빈 Flow 배열을 허용한다.
- 서로 다른 Flow로 나뉜 hint relation은 저장하거나 Canvas에 표시하지 않는다.
- AI relation 검증만 실패하면 유효한 AI files/roles/flows는 유지하고 deterministic same-flow relation만 사용한다.
- Worker는 입력 graph version을 보존하여 v1 입력에는 v1 schema/result, v2 입력에는 v2 schema/result를 반환한다.
- 새 최초 Canvas는 `workflowOrder`를 유일한 rank spine으로 사용하며 기존 저장 geometry는 자동 변경하지 않는다.
- `현재 Flow 자동 정렬`은 pinned node를 이동하지 않는다.
- 배포 중 PR Review 분석 요청을 중지하고 queue가 빈 상태에서 Worker를 먼저, App Server를 다음으로 배포한다.
- 전체 monorepo 테스트는 실행하지 않고 관련 App Server·AI Worker·Frontend 테스트와 변경 패키지 정적 검사만 실행한다.

---

### Task 1: App Server v1/v2 후보와 handoff 계약

**Files:**
- Create: `fixtures/pr-review-semantic-graph-v1-v2.json`
- Modify: `apps/app-server/src/modules/pr-review/pr-review-semantic-graph.ts`
- Modify: `apps/app-server/src/modules/pr-review/pr-review-semantic-flow.ts`
- Modify: `apps/app-server/src/modules/pr-review/pr-review-semantic-contract.ts`
- Test: `apps/app-server/scripts/pr-review/semantic-graph-candidates.test.mjs`
- Test: `apps/app-server/scripts/pr-review/analysis-input-handoff.test.mjs`

**Interfaces:**
- Produces: `PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1`, `PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2`
- Produces: `buildPrReviewSemanticGraphHandoffV1(files)`, `buildPrReviewSemanticGraphHandoffV2(files)`
- Produces: v2 relation의 `groupingBinding: "locked" | "hint"`
- Consumes: 기존 `PrReviewSemanticGraphFileInput`, role inference, relation inference

- [ ] **Step 1: v1 보존과 v2 binding/Flow 분리를 나타내는 fixture와 실패 테스트를 작성한다**

`fixtures/pr-review-semantic-graph-v1-v2.json`에 최소한 아래 case를 둔다.

```json
{
  "v1": {
    "schemaVersion": "pr-review-semantic-graph:v1"
  },
  "v2": {
    "schemaVersion": "pr-review-semantic-graph:v2",
    "lockedEvidence": ["matching_test_filename", "package_lock_manifest"],
    "hintEvidencePrefixes": [
      "relative_import:",
      "explicit_file_reference",
      "shared_identifier:"
    ],
    "maxFlows": 8,
    "limits": {
      "titleChars": 255,
      "descriptionChars": 10000,
      "roleReasonChars": 500,
      "relationReasonChars": 500,
      "relationReasonUtf8Bytes": 500
    }
  }
}
```

`semantic-graph-candidates.test.mjs`에는 다음 행위를 직접 검증한다.

```js
const v2 = buildDeterministicSemanticGraphCandidatesV2(files);
assert.equal(
  v2.relations.find((relation) => relation.evidence.startsWith("relative_import:"))
    .groupingBinding,
  "hint"
);
assert.equal(
  v2.relations.find((relation) => relation.evidence === "matching_test_filename")
    .groupingBinding,
  "locked"
);
assert.equal(
  v2.flows.some((flow) =>
    flow.filePaths.includes("apps/app-server/src/a.ts") &&
    flow.filePaths.includes("apps/ai-worker/app/b.py")
  ),
  false
);
```

- [ ] **Step 2: 실패를 확인한다**

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/semantic-graph-candidates.test.mjs
```

Expected: `buildDeterministicSemanticGraphCandidatesV2` export 또는 `groupingBinding`이 없어 실패한다.

- [ ] **Step 3: v1 후보 생성은 그대로 두고 v2 후보 생성기를 추가한다**

`pr-review-semantic-graph.ts`의 public contract를 아래 형태로 만든다.

```ts
export type PrReviewGroupingBinding = "locked" | "hint";

export interface PrReviewRelationCandidateV2
  extends PrReviewRelationCandidate {
  groupingBinding: PrReviewGroupingBinding;
}

export interface PrReviewSemanticGraphCandidatesV2 {
  files: PrReviewFileRoleCandidate[];
  relations: PrReviewRelationCandidateV2[];
  flows: PrReviewFlowCandidate[];
}

export function buildDeterministicSemanticGraphCandidatesV2(
  inputFiles: readonly PrReviewSemanticGraphFileInput[]
): PrReviewSemanticGraphCandidatesV2 {
  const candidates = buildDeterministicSemanticGraphCandidates(inputFiles);
  const relations = candidates.relations.map((relation) => ({
    ...relation,
    groupingBinding: isLockedEvidence(relation.evidence) ? "locked" : "hint"
  }));
  return {
    files: candidates.files,
    relations,
    flows: buildSemanticFlowCandidatesV2(candidates.files, relations)
  };
}

function isLockedEvidence(evidence: string): boolean {
  return evidence === "matching_test_filename" ||
    evidence === "package_lock_manifest";
}
```

`pr-review-semantic-flow.ts`는 v1의 모든 relation union을 유지하고 v2에서 locked relation만 union한다.

```ts
export function buildSemanticFlowCandidatesV2(
  files: readonly PrReviewFileRoleCandidate[],
  relations: readonly PrReviewRelationCandidateV2[]
): PrReviewFlowCandidate[] {
  return buildSemanticFlowCandidates(
    files,
    relations.filter((relation) => relation.groupingBinding === "locked")
  );
}
```

`pr-review-semantic-contract.ts`는 두 version과 builder를 분리한다.

```ts
export const PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1 =
  "pr-review-semantic-graph:v1" as const;
export const PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2 =
  "pr-review-semantic-graph:v2" as const;

export function buildPrReviewSemanticGraphHandoffV1(
  files: readonly PrReviewSemanticGraphFileInput[]
) {
  return addRolePolicy(buildDeterministicSemanticGraphCandidates(files));
}

export function buildPrReviewSemanticGraphHandoffV2(
  files: readonly PrReviewSemanticGraphFileInput[]
) {
  return addRolePolicy(buildDeterministicSemanticGraphCandidatesV2(files));
}
```

- [ ] **Step 4: 새 분석 input이 v2 handoff를 반환하도록 실패 테스트 후 최소 변경한다**

`analysis-input-handoff.test.mjs`에 아래 기대값을 추가하고 먼저 실패를 확인한다.

```js
assert.equal(input.graphSchemaVersion, "pr-review-semantic-graph:v2");
assert.ok(
  input.semanticGraph.relations.every((relation) =>
    relation.groupingBinding === "locked" ||
    relation.groupingBinding === "hint"
  )
);
```

그 다음 `pr-review.service.ts`의 새 Job input 조립부에서 v2 constant/builder를 사용한다.

- [ ] **Step 5: 관련 테스트를 통과시킨다**

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/semantic-graph-candidates.test.mjs
node scripts/pr-review/analysis-input-handoff.test.mjs
```

Expected: 모두 exit code 0.

- [ ] **Step 6: 커밋한다**

```powershell
git add fixtures/pr-review-semantic-graph-v1-v2.json apps/app-server/src/modules/pr-review/pr-review-semantic-graph.ts apps/app-server/src/modules/pr-review/pr-review-semantic-flow.ts apps/app-server/src/modules/pr-review/pr-review-semantic-contract.ts apps/app-server/src/modules/pr-review/pr-review.service.ts apps/app-server/scripts/pr-review/semantic-graph-candidates.test.mjs apps/app-server/scripts/pr-review/analysis-input-handoff.test.mjs
git commit -m "feat: PR Review semantic graph v2 후보 계약 추가 (#772)"
```

### Task 2: AI Worker v1/v2 version mirror와 출력 구조

**Files:**
- Modify: `apps/ai-worker/app/pr_review_semantic_graph.py`
- Modify: `apps/ai-worker/app/pr_review_analysis_processor.py`
- Test: `apps/ai-worker/tests/test_pr_review_analysis_processor.py`
- Read: `fixtures/pr-review-semantic-graph-v1-v2.json`

**Interfaces:**
- Consumes: Task 1의 v1/v2 version 문자열, v2 `groupingBinding`, 공통 limits
- Produces: 입력 version을 보존하는 `SemanticGraphInput.schema_version`
- Produces: v1 candidate-key Flow output과 v2 candidate-key 없는 Flow output

- [ ] **Step 1: Worker가 v1을 그대로 mirror하고 v2 schema를 생성하는 실패 테스트를 작성한다**

```py
def test_v2_graph_schema_allows_regrouped_flows_without_candidate_key():
    parsed = parse_semantic_graph_input(v2_input_payload(), KNOWN_PATHS)
    schema = semantic_graph_output_schema(parsed)
    flow = schema["properties"]["flows"]["items"]
    assert "candidateKey" not in flow["required"]
    assert parsed.schema_version == "pr-review-semantic-graph:v2"


def test_v1_input_still_serializes_v1():
    analysis = parse_analysis_output(v1_provider_output(), v1_input())
    serialized = _serialize_analysis_result(analysis)
    assert serialized["graphSchemaVersion"] == "pr-review-semantic-graph:v1"
```

v2 relation의 endpoint/type candidate mismatch와 cross-Flow 관계는 Worker가 전달하고 App Server가 판정한다는 case도 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run:

```powershell
Set-Location apps/ai-worker
& .venv/Scripts/python.exe -m pytest -q tests/test_pr_review_analysis_processor.py
```

Expected: v2 version이 거절되거나 v2 Flow schema가 candidateKey를 요구해 실패한다.

- [ ] **Step 3: version-discriminated input/output과 prompt/schema를 구현한다**

`pr_review_semantic_graph.py`에 다음 version 모델을 둔다.

```py
PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1 = "pr-review-semantic-graph:v1"
PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2 = "pr-review-semantic-graph:v2"
PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSIONS = {
    PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V1,
    PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2,
}

@dataclass(frozen=True)
class SemanticGraphInput:
    schema_version: str
    files: tuple[SemanticGraphFileInput, ...]
    relations: tuple[SemanticGraphRelationInput, ...]
    flows: tuple[SemanticGraphFlowInput, ...]

@dataclass(frozen=True)
class SemanticGraphFlowOutput:
    candidate_key: str | None
    title: str
    description: str
    review_order: tuple[str, ...]
```

v2 prompt에는 아래 정책을 그대로 넣는다.

```py
"Group every input file exactly once into at most 8 flows. "
"Keep files connected by groupingBinding=locked in the same flow. "
"Use groupingBinding=hint only as evidence; it must not force two flows together."
```

v2 schema의 Flow required는 `["title", "description", "reviewOrder"]`, v1은 기존 4개 필드를 유지한다. v2 parser는 전체 파일 coverage와 Flow 수 같은 구조를 검사하지만 locked 분리나 relation cross-field 의미 판정으로 Graph 전체를 제거하지 않는다.

- [ ] **Step 4: App Server와 동일한 문자열 제한을 Worker parser/schema에 적용한다**

```py
FLOW_TITLE_MAX_CHARS = 255
FLOW_DESCRIPTION_MAX_CHARS = 10_000
ROLE_REASON_MAX_CHARS = 500
RELATION_REASON_MAX_CHARS = 500
RELATION_REASON_MAX_UTF8_BYTES = 500

def _require_bounded_string(
    value: dict[str, object],
    key: str,
    *,
    max_chars: int,
    max_utf8_bytes: int | None = None,
) -> str:
    result = _require_string(value, key)
    if len(result) > max_chars:
        raise ValueError(f"Invalid {key}")
    if max_utf8_bytes is not None and len(result.encode("utf-8")) > max_utf8_bytes:
        raise ValueError(f"Invalid {key}")
    return result
```

`pr_review_analysis_processor.py`는 hard-coded constant 대신 받은 graph의 version으로 schema와 result를 만든다.

```py
graph_schema_version = (
    semantic_graph_input.schema_version
    if semantic_graph_input is not None
    else None
)
```

- [ ] **Step 5: Worker 테스트와 정적 검사를 통과시킨다**

Run:

```powershell
Set-Location apps/ai-worker
& .venv/Scripts/python.exe -m pytest -q tests/test_pr_review_analysis_processor.py
& .venv/Scripts/python.exe -m ruff check app/pr_review_semantic_graph.py app/pr_review_analysis_processor.py tests/test_pr_review_analysis_processor.py
```

Expected: 모두 exit code 0.

- [ ] **Step 6: 커밋한다**

```powershell
git add apps/ai-worker/app/pr_review_semantic_graph.py apps/ai-worker/app/pr_review_analysis_processor.py apps/ai-worker/tests/test_pr_review_analysis_processor.py
git commit -m "feat: PR Review Worker v2 graph 계약 지원 (#772)"
```

### Task 3: App Server v2 Flow 검증과 relation-only fallback

**Files:**
- Modify: `apps/app-server/src/modules/pr-review/pr-review-semantic-validator.ts`
- Modify: `apps/app-server/src/modules/pr-review/pr-review.service.ts`
- Test: `apps/app-server/scripts/pr-review/semantic-graph-validator.test.mjs`
- Test: `apps/app-server/scripts/pr-review/analysis-result-handoff.test.mjs`

**Interfaces:**
- Consumes: Task 1의 v1/v2 handoff와 Task 2의 v2 output
- Produces: stable membership-hash `candidateKey`
- Produces: `validationStatus: "validated_ai" | "validated_ai_relation_fallback" | "deterministic_fallback"`
- Produces: `fallbackReason: "missing_ai_graph" | "invalid_ai_graph" | "invalid_ai_relations" | null`

- [ ] **Step 1: 전역 regrouping, locked 보존, relation-only fallback 실패 테스트를 작성한다**

`semantic-graph-validator.test.mjs`에 아래 행위를 분리해 추가한다.

```js
const regrouped = resolvePrReviewSemanticGraph(v2AnalysisWithTwoFlows(), v2Candidates);
assert.equal(regrouped.validationStatus, "validated_ai");
assert.deepEqual(
  regrouped.flows.map((flow) => flow.reviewOrder),
  [["apps/app-server/src/job.ts"], ["apps/ai-worker/app/worker.py"]]
);

const relationFallback = resolvePrReviewSemanticGraph(
  v2AnalysisWithValidFlowsAndCrossFlowRelation(),
  v2Candidates
);
assert.equal(relationFallback.validationStatus, "validated_ai_relation_fallback");
assert.deepEqual(
  relationFallback.flows.map((flow) => flow.title),
  ["작업 생성", "Worker 처리"]
);
assert.equal(
  relationFallback.relations.every((relation) =>
    relationFallback.flows.some((flow) =>
      flow.candidateKey === relation.flowKey &&
      flow.reviewOrder.includes(relation.fromFilePath) &&
      flow.reviewOrder.includes(relation.toFilePath)
    )
  ),
  true
);
```

locked component split, 9개 Flow, 누락/중복 파일은 전체 deterministic fallback이어야 한다. 빈 PR의 v2 빈 Flow 배열은 기존 빈 fallback Flow로 정규화한다. AI relation이 비어도 locked relation은 `source: "rule"`로 남고, membership hash Flow에서도 relation limiter가 빈 결과를 만들지 않는 case를 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/semantic-graph-validator.test.mjs
```

Expected: v2가 invalid graph 전체 fallback되거나 새 validation status가 없어 실패한다.

- [ ] **Step 3: v1 validator를 보존하고 v2 files/flows와 relations를 단계별로 검증한다**

```ts
function validateAiGraphV2(
  analysis: Record<string, unknown>,
  candidates: PrReviewSemanticGraphHandoffPayloadV2
): PrReviewValidatedSemanticGraph {
  const graph = requireRecord(analysis.semanticGraph);
  const files = validateV2Files(requireArray(graph.files), candidates.files);
  const flows = validateAndKeyV2Flows(
    requireArray(graph.flows),
    candidates.files.map((file) => file.filePath),
    buildLockedComponents(candidates.relations)
  );
  try {
    const relations = mergeLockedRelations(
      validateV2Relations(requireArray(graph.relations), candidates, flows),
      candidates,
      flows
    );
    return {
      schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2,
      files,
      flows,
      relations: limitRelations(relations, flows),
      validationStatus: "validated_ai",
      fallbackReason: null
    };
  } catch {
    const relations = buildDeterministicRelationsForAcceptedFlows(
      candidates,
      flows
    );
    return {
      schemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION_V2,
      files,
      flows,
      relations: limitRelations(relations, flows),
      validationStatus: "validated_ai_relation_fallback",
      fallbackReason: "invalid_ai_relations"
    };
  }
}
```

`validateV2Files`는 기존 file coverage·role lock·500자 role reason 검증을 재사용한다. `buildLockedComponents`는 `groupingBinding === "locked"` relation만 union한다. `validateAndKeyV2Flows`는 1..8 Flow, 전역 file coverage, locked component 보존과 문자열 제한을 검사하고 stable key를 만든다. `validateV2Relations`는 accepted Flow 안의 endpoint, exact candidate match, self/duplicate 여부를 검사한다.

stable key는 정렬된 membership 전체를 hash한다.

```ts
function membershipFlowKey(filePaths: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...filePaths].sort().join("\u0000"), "utf8")
    .digest("hex");
  return `ai-flow:${digest}`;
}
```

locked relation의 connected component가 하나의 accepted Flow key에 속하는지 검증한다. Flow 수와 파일 coverage 검증은 relation 검증보다 먼저 끝낸다.

- [ ] **Step 4: limiter와 persistence 입력을 확정된 Flow 기준으로 바꾼다**

```ts
function limitRelations(
  relations: readonly PrReviewValidatedGraphRelation[],
  flows: readonly PrReviewValidatedGraphFlow[]
): PrReviewValidatedGraphRelation[] {
  const flowFileCount = new Map(
    flows.map((flow) => [flow.candidateKey, flow.reviewOrder.length])
  );
  // 기존 source/confidence 우선순위와 전체 100개 제한은 유지한다.
}
```

`pr-review.service.ts`는 result의 `graphSchemaVersion`에 따라 v1/v2 후보 builder를 고르고, relation-only fallback은 파일 경로 없이 안전한 category만 로그한다. 기존 `persistAnalysisResult`의 Flow/membership/relation transaction 구조는 유지한다.

- [ ] **Step 5: result handoff 통합 테스트를 추가하고 통과시킨다**

`analysis-result-handoff.test.mjs`에서 v2 AI Flow의 두 membership이 별도 `review_flows`로 insert되고, cross-Flow relation은 insert되지 않으며, 같은 Flow locked relation은 insert되는지 확인한다.

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/semantic-graph-validator.test.mjs
node scripts/pr-review/analysis-result-handoff.test.mjs
```

Expected: 모두 exit code 0.

- [ ] **Step 6: 커밋한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review-semantic-validator.ts apps/app-server/src/modules/pr-review/pr-review.service.ts apps/app-server/scripts/pr-review/semantic-graph-validator.test.mjs apps/app-server/scripts/pr-review/analysis-result-handoff.test.mjs
git commit -m "feat: PR Review AI Flow 재구성 검증 추가 (#772)"
```

### Task 4: App Server 최초 Canvas의 review-order spine과 semantic lane

**Files:**
- Modify: `apps/app-server/src/modules/pr-review/pr-review-canvas-layout.ts`
- Test: `apps/app-server/scripts/pr-review/canvas-materializer.test.mjs`

**Interfaces:**
- Consumes: 기존 `PrReviewCanvasLayoutFile.workflowOrder`와 validated same-flow relations
- Produces: 1→2→3 x축 rank와 node 아래쪽의 deterministic semantic routes

- [ ] **Step 1: 역방향·순환 relation과 dense lane 회귀 테스트를 작성한다**

```js
const layout = await buildPrReviewCanvasGraphLayout({
  files: [
    file("one", 1, "support"),
    file("two", 2, "entry"),
    file("three", 3, "verification")
  ],
  relations: [
    semantic("three-to-one", "three", "one"),
    semantic("two-to-one", "two", "one"),
    reviewOrder("one-to-two", "one", "two"),
    reviewOrder("two-to-three", "two", "three")
  ]
});
assert.ok(layout.nodeGeometryByRoomFileId.get("one").x <
  layout.nodeGeometryByRoomFileId.get("two").x);
assert.ok(layout.nodeGeometryByRoomFileId.get("two").x <
  layout.nodeGeometryByRoomFileId.get("three").x);
```

semantic route의 모든 중간 Y가 node bottom보다 아래인지, 겹치지 않는 horizontal span이 lane을 재사용하는지, 사용한 lane bottom보다 다음 Flow top이 아래인지 검증한다. 기존 shape와 route 보존 테스트는 유지한다.

- [ ] **Step 2: 실패를 확인한다**

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/canvas-materializer.test.mjs
```

Expected: role/semantic edge가 rank를 바꾸거나 semantic route가 node 위에 있어 실패한다.

- [ ] **Step 3: ELK에는 synthetic review-order spine만 전달한다**

```ts
function buildReviewOrderSpine(files: readonly PrReviewCanvasLayoutFile[]) {
  return files.slice(1).map((file, index) => ({
    id: `layout-spine:${files[index].roomFileId}->${file.roomFileId}`,
    sources: [files[index].roomFileId],
    targets: [file.roomFileId]
  }));
}
```

`compareFilesInFlow`는 `workflowOrder`, `filePath`, `roomFileId` 순서만 사용한다. `getRoleLayoutOptions`와 entry/verification FIRST/LAST constraint를 제거한다.

- [ ] **Step 4: semantic relation을 node 아래 lane으로 route하고 다음 Flow 간격에 반영한다**

relation의 horizontal interval을 안정 정렬한 뒤, 끝난 interval과 겹치지 않는 기존 lane을 재사용한다. lane을 찾지 못하면 새 lane을 만든다.

```ts
const MAX_SAME_FLOW_ROUTE_LANES = 8;
type RouteLane = { lastEndX: number; y: number };

function assignBottomLane(
  startX: number,
  endX: number,
  flowBottom: number,
  lanes: RouteLane[]
): number {
  const lane = lanes.find((candidate) => candidate.lastEndX < startX);
  if (lane) {
    lane.lastEndX = endX;
    return lane.y;
  }
  if (lanes.length >= MAX_SAME_FLOW_ROUTE_LANES) {
    const reused = [...lanes].sort(
      (left, right) => left.lastEndX - right.lastEndX || left.y - right.y
    )[0];
    reused.lastEndX = Math.max(reused.lastEndX, endX);
    return reused.y;
  }
  const y = flowBottom + SAME_FLOW_ROUTE_OFFSET +
    lanes.length * SAME_FLOW_ROUTE_GAP;
  lanes.push({ lastEndX: endX, y });
  return y;
}
```

lane 최대 높이를 `nextFlowY` 계산에 포함한다. 실제 relation ID route만 결과에 저장하고 synthetic spine ID는 저장하지 않는다.

- [ ] **Step 5: 테스트를 통과시킨다**

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/canvas-materializer.test.mjs
```

Expected: exit code 0.

- [ ] **Step 6: 커밋한다**

```powershell
git add apps/app-server/src/modules/pr-review/pr-review-canvas-layout.ts apps/app-server/scripts/pr-review/canvas-materializer.test.mjs
git commit -m "fix: PR Review Canvas 리뷰 순서 배치 수정 (#772)"
```

### Task 5: Frontend 현재 Flow 자동 정렬의 review-order spine

**Files:**
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/pr-review-graph-exploration.ts`
- Modify: `apps/frontend/src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx`
- Test: `apps/frontend/scripts/pr-review/graph-exploration.test.mjs`

**Interfaces:**
- Consumes: file shape의 `workflowOrder`
- Produces: pinned node를 제외하고 workflowOrder 순으로 증가하는 x 좌표

- [ ] **Step 1: semantic relation과 무관한 자동 정렬 실패 테스트를 작성한다**

```js
const positions = createPrReviewFlowLayout(
  [
    node("one", 1, false),
    node("two", 2, false),
    node("three", 3, false)
  ],
  [
    relation("three", "one", ["depends_on"]),
    relation("two", "one", ["supports"])
  ],
  "flow-1"
);
assert.ok(positions.get("one").x < positions.get("two").x);
assert.ok(positions.get("two").x < positions.get("three").x);
```

pinned node가 결과 map에 없고, 모든 node가 pinned이면 빈 map인지 별도 case로 검증한다.

- [ ] **Step 2: 실패를 확인한다**

Run:

```powershell
Set-Location apps/frontend
node --experimental-strip-types scripts/pr-review/graph-exploration.test.mjs
```

Expected: semantic relation이 Dagre rank를 바꿔 x 순서 assertion이 실패한다.

- [ ] **Step 3: node에 workflowOrder를 전달하고 movable spine만 Dagre에 넣는다**

`PrReviewGraphNode`에 `workflowOrder: number`를 추가하고 `getGraphNodes`가 `shape.props.workflowOrder`를 넘긴다. 기존 함수 호출 계약을 유지하기 위해 사용하지 않는 relation 인자는 `_relations`로 이름만 바꾼다.

```ts
const orderedMovableNodes = [...movableNodes].sort(
  (left, right) =>
    left.workflowOrder - right.workflowOrder ||
    left.id.localeCompare(right.id)
);
for (let index = 1; index < orderedMovableNodes.length; index += 1) {
  graph.setEdge({
    name: `layout-spine:${index}`,
    v: orderedMovableNodes[index - 1].id,
    w: orderedMovableNodes[index].id
  });
}
```

기존 `relations`를 Dagre edge로 넣는 loop는 제거한다. pinned 제외, preview/apply persistence, 이동 후 edge 재계산 흐름은 변경하지 않는다.

- [ ] **Step 4: Frontend 관련 테스트와 lint를 통과시킨다**

Run:

```powershell
Set-Location apps/frontend
node --experimental-strip-types scripts/pr-review/graph-exploration.test.mjs
node --experimental-strip-types scripts/pr-review/test.mjs
npm.cmd run lint
```

Expected: 모두 exit code 0.

- [ ] **Step 5: 커밋한다**

```powershell
git add apps/frontend/src/features/pr-review/components/review-canvas/pr-review-graph-exploration.ts apps/frontend/src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx apps/frontend/scripts/pr-review/graph-exploration.test.mjs
git commit -m "fix: PR Review Flow 자동 정렬 순서 수정 (#772)"
```

### Task 6: API 계약 문서와 통합 검증

**Files:**
- Modify: `docs/api/pr-review-api.md`
- Verify: Task 1~5의 모든 변경 파일

**Interfaces:**
- Documents: v1/v2 handoff, locked/hint, v2 Flow output, relation-only fallback, review-order layout, Worker-first maintenance deployment

- [ ] **Step 1: API 문서의 v1-only 설명을 v1/v2 계약으로 갱신한다**

문서에는 다음 내용을 명시한다.

```text
v1: 입력 candidate Flow와 정확히 대응하며 membership을 바꿀 수 없다.
v2: 모든 변경 파일을 1..min(8, file count) Flow로 정확히 한 번 partition한다.
locked: matching_test_filename, package_lock_manifest
hint: relative_import, explicit_file_reference, shared_identifier
relation-only invalid: AI Flow 유지 + deterministic same-flow relation fallback
deployment: PR Review 중지/queue empty → Worker → App Server → health 확인 → 사용 재개
layout: 최초 빈 Review Canvas와 명시적 자동 정렬에서 workflowOrder spine 사용
```

- [ ] **Step 2: 문서 placeholder와 diff whitespace를 검사한다**

Run:

```powershell
rg -n "T[O]DO|T[B]D|미[정]" docs/api/pr-review-api.md docs/superpowers/plans/2026-07-19-pr-review-semantic-flow-layout.md
git diff --check
```

Expected: `rg`는 출력 없이 exit code 1, `git diff --check`는 exit code 0.

- [ ] **Step 3: 요청된 관련 검증만 새로 실행한다**

Run:

```powershell
Set-Location apps/app-server
npm.cmd run build
node scripts/pr-review/semantic-graph-candidates.test.mjs
node scripts/pr-review/semantic-graph-validator.test.mjs
node scripts/pr-review/analysis-input-handoff.test.mjs
node scripts/pr-review/analysis-result-handoff.test.mjs
node scripts/pr-review/canvas-materializer.test.mjs
npm.cmd run lint

Set-Location ../ai-worker
& .venv/Scripts/python.exe -m pytest -q tests/test_pr_review_analysis_processor.py
& .venv/Scripts/python.exe -m ruff check app/pr_review_semantic_graph.py app/pr_review_analysis_processor.py tests/test_pr_review_analysis_processor.py

Set-Location ../frontend
node --experimental-strip-types scripts/pr-review/graph-exploration.test.mjs
node --experimental-strip-types scripts/pr-review/test.mjs
npm.cmd run lint
```

Expected: 모든 명령 exit code 0. 전체 monorepo test는 실행하지 않는다.

- [ ] **Step 4: 최종 self-review와 API 문서 커밋을 한다**

```powershell
git diff origin/dev...HEAD --stat
git diff origin/dev...HEAD --check
git add docs/api/pr-review-api.md
git commit -m "docs: PR Review semantic graph v2 계약 반영 (#772)"
```

최종 review에서는 다음을 직접 대조한다.

- 모든 변경 파일이 한 Flow에 정확히 한 번 포함되는가
- locked group이 나뉘지 않는가
- hint가 Flow를 강제로 합치지 않는가
- invalid relation이 AI Flow까지 폐기하지 않는가
- 최초/수동 정렬 모두 1→2→3인가
- 기존 geometry와 pinned node가 보존되는가
- DB migration이나 public response 변경이 섞이지 않았는가
