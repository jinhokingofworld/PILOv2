import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolvePrReviewSemanticGraph } = require(
  "../../dist/modules/pr-review/pr-review-semantic-validator.js"
);

const FILE_A = "src/user.controller.ts";
const FILE_B = "src/user.service.ts";
const FILE_C = "docs/users.md";
const CANDIDATE_RELATION_KEY = `depends_on:${FILE_A}->${FILE_B}`;

function baseCandidates() {
  return {
    files: [
      {
        filePath: FILE_A,
        roleType: "entry",
        confidence: 90,
        evidence: "entry_path",
        roleOverrideAllowed: false
      },
      {
        filePath: FILE_B,
        roleType: "core_logic",
        confidence: 65,
        evidence: "code_file_fallback",
        roleOverrideAllowed: true
      },
      {
        filePath: FILE_C,
        roleType: "support",
        confidence: 90,
        evidence: "support_path",
        roleOverrideAllowed: false
      }
    ],
    relations: [
      {
        key: CANDIDATE_RELATION_KEY,
        fromFilePath: FILE_A,
        toFilePath: FILE_B,
        relationType: "depends_on",
        source: "rule",
        confidence: 90,
        evidence: "relative_import:./user.service"
      }
    ],
    flows: [
      {
        key: "candidate-flow-1",
        title: "진입 흐름 변경",
        filePaths: [FILE_A, FILE_B, FILE_C],
        relationKeys: [CANDIDATE_RELATION_KEY],
        fallback: false
      }
    ]
  };
}

function validAnalysis(overrides = {}) {
  return {
    graphSchemaVersion: "pr-review-semantic-graph:v1",
    semanticGraph: {
      files: [
        { filePath: FILE_A, roleType: "entry", roleReason: "HTTP 진입점" },
        {
          filePath: FILE_B,
          roleType: "api_contract",
          roleReason: "낮은 confidence 역할 보정"
        },
        { filePath: FILE_C, roleType: "support", roleReason: "기능 문서" }
      ],
      relations: [
        {
          candidateKey: CANDIDATE_RELATION_KEY,
          fromFilePath: FILE_A,
          toFilePath: FILE_B,
          relationType: "depends_on",
          reason: "Controller가 service를 호출합니다."
        },
        {
          candidateKey: null,
          fromFilePath: FILE_B,
          toFilePath: FILE_A,
          relationType: "passes_data_to",
          reason: "Service 결과가 controller 응답으로 전달됩니다."
        }
      ],
      flows: [
        {
          candidateKey: "candidate-flow-1",
          title: "사용자 API 변경",
          description: "진입점부터 계약과 문서를 확인합니다.",
          reviewOrder: [FILE_C, FILE_B, FILE_A]
        }
      ],
      ...overrides
    }
  };
}

{
  const result = resolvePrReviewSemanticGraph(validAnalysis(), baseCandidates());

  assert.equal(result.validationStatus, "validated_ai");
  assert.equal(result.fallbackReason, null);
  assert.equal(result.files[1].roleType, "api_contract");
  assert.deepEqual(
    result.relations.map((relation) => ({
      relationType: relation.relationType,
      source: relation.source,
      confidence: relation.confidence
    })),
    [
      { relationType: "depends_on", source: "hybrid", confidence: 90 },
      { relationType: "passes_data_to", source: "ai", confidence: 60 }
    ]
  );
}

function v2Candidates() {
  const filePaths = [
    "apps/app-server/src/job.ts",
    "apps/app-server/src/job.test.ts",
    "apps/ai-worker/app/worker.py"
  ];
  const lockedKey = `tests:${filePaths[1]}->${filePaths[0]}`;
  return {
    files: filePaths.map((filePath) => ({
      filePath,
      roleType: "core_logic",
      confidence: 65,
      evidence: "code_file_fallback",
      roleOverrideAllowed: true
    })),
    relations: [
      {
        key: lockedKey,
        fromFilePath: filePaths[1],
        toFilePath: filePaths[0],
        relationType: "tests",
        source: "rule",
        confidence: 90,
        evidence: "matching_test_filename",
        groupingBinding: "locked"
      }
    ],
    flows: [
      {
        key: "candidate-flow-1",
        title: "핵심 구현",
        filePaths: filePaths.slice(0, 2),
        relationKeys: [lockedKey],
        fallback: false
      },
      {
        key: "candidate-flow-fallback",
        title: "기타 변경",
        filePaths: [filePaths[2]],
        relationKeys: [],
        fallback: true
      }
    ]
  };
}

function v2Analysis({ flows, relations = [], files } = {}) {
  const candidates = v2Candidates();
  return {
    graphSchemaVersion: "pr-review-semantic-graph:v2",
    semanticGraph: {
      files:
        files ??
        candidates.files.map((file) => ({
          filePath: file.filePath,
          roleType: file.roleType,
          roleReason: "v2 역할 검증 fixture"
        })),
      flows:
        flows ?? [
          {
            title: "작업 생성",
            description: "Job 구현과 검증을 함께 검토합니다.",
            reviewOrder: [
              "apps/app-server/src/job.ts",
              "apps/app-server/src/job.test.ts"
            ]
          },
          {
            title: "Worker 처리",
            description: "Worker 처리를 별도 흐름으로 검토합니다.",
            reviewOrder: ["apps/ai-worker/app/worker.py"]
          }
        ],
      relations
    }
  };
}

{
  const result = resolvePrReviewSemanticGraph(v2Analysis(), v2Candidates());

  assert.equal(result.validationStatus, "validated_ai");
  assert.deepEqual(
    result.flows.map((flow) => flow.reviewOrder),
    [
      ["apps/app-server/src/job.ts", "apps/app-server/src/job.test.ts"],
      ["apps/ai-worker/app/worker.py"]
    ]
  );
  assert.equal(result.flows.every((flow) => flow.candidateKey.startsWith("ai-flow:")), true);
  assert.deepEqual(result.relations.map((relation) => relation.source), ["rule"]);
}

{
  const candidates = v2Candidates();
  const lockedRelation = candidates.relations[0];
  const result = resolvePrReviewSemanticGraph(
    v2Analysis({
      relations: [
        {
          candidateKey: null,
          fromFilePath: lockedRelation.fromFilePath,
          toFilePath: lockedRelation.toFilePath,
          relationType: lockedRelation.relationType,
          reason: "기존 locked 후보를 새 AI relation으로 중복 제안합니다."
        }
      ]
    }),
    candidates
  );

  assert.equal(result.validationStatus, "validated_ai_relation_fallback");
  assert.equal(result.fallbackReason, "invalid_ai_relations");
  assert.deepEqual(result.flows.map((flow) => flow.title), ["작업 생성", "Worker 처리"]);
  assert.deepEqual(
    result.relations.map((relation) => ({
      relationType: relation.relationType,
      source: relation.source,
      confidence: relation.confidence,
      reason: relation.reason
    })),
    [
      {
        relationType: "tests",
        source: "rule",
        confidence: 90,
        reason: "matching_test_filename"
      }
    ]
  );
}

{
  const result = resolvePrReviewSemanticGraph(
    v2Analysis({
      relations: [
        {
          candidateKey: null,
          fromFilePath: "apps/app-server/src/job.ts",
          toFilePath: "apps/app-server/src/job.test.ts",
          relationType: "depends_on",
          reason: "기존 후보와 다른 새 AI relation입니다."
        }
      ]
    }),
    v2Candidates()
  );

  assert.equal(result.validationStatus, "validated_ai");
  assert.equal(
    result.relations.some(
      (relation) =>
        relation.source === "ai" &&
        relation.relationType === "depends_on" &&
        relation.reason === "기존 후보와 다른 새 AI relation입니다."
    ),
    true
  );
}

{
  const result = resolvePrReviewSemanticGraph(
    v2Analysis({
      relations: [
        {
          candidateKey: null,
          fromFilePath: "apps/app-server/src/job.ts",
          toFilePath: "apps/ai-worker/app/worker.py",
          relationType: "depends_on",
          reason: "서로 다른 Flow를 직접 연결합니다."
        }
      ]
    }),
    v2Candidates()
  );

  assert.equal(result.validationStatus, "validated_ai_relation_fallback");
  assert.equal(result.fallbackReason, "invalid_ai_relations");
  assert.deepEqual(result.flows.map((flow) => flow.title), ["작업 생성", "Worker 처리"]);
  assert.equal(
    result.relations.every((relation) =>
      result.flows.some(
        (flow) =>
          flow.candidateKey === relation.flowKey &&
          flow.reviewOrder.includes(relation.fromFilePath) &&
          flow.reviewOrder.includes(relation.toFilePath)
      )
    ),
    true
  );
}

for (const flows of [
  [
    {
      title: "분리된 구현",
      description: "잠긴 test/implementation pair를 나눕니다.",
      reviewOrder: ["apps/app-server/src/job.ts"]
    },
    {
      title: "분리된 테스트",
      description: "잠긴 test/implementation pair를 나눕니다.",
      reviewOrder: ["apps/app-server/src/job.test.ts"]
    },
    {
      title: "Worker",
      description: "독립 Worker입니다.",
      reviewOrder: ["apps/ai-worker/app/worker.py"]
    }
  ],
  Array.from({ length: 9 }, (_, index) => ({
    title: `Flow ${index + 1}`,
    description: "최대 Flow 개수를 초과합니다.",
    reviewOrder: [
      "apps/app-server/src/job.ts",
      "apps/app-server/src/job.test.ts",
      "apps/ai-worker/app/worker.py"
    ]
  })),
  [
    {
      title: "누락된 파일",
      description: "변경 파일 전체를 포함하지 않습니다.",
      reviewOrder: ["apps/app-server/src/job.ts", "apps/app-server/src/job.test.ts"]
    }
  ],
  [
    {
      title: "중복된 파일",
      description: "파일을 두 번 포함합니다.",
      reviewOrder: [
        "apps/app-server/src/job.ts",
        "apps/app-server/src/job.test.ts",
        "apps/app-server/src/job.ts",
        "apps/ai-worker/app/worker.py"
      ]
    }
  ]
]) {
  const result = resolvePrReviewSemanticGraph(v2Analysis({ flows }), v2Candidates());
  assert.equal(result.validationStatus, "deterministic_fallback");
  assert.equal(result.fallbackReason, "invalid_ai_graph");
}

{
  const result = resolvePrReviewSemanticGraph(
    {
      graphSchemaVersion: "pr-review-semantic-graph:v2",
      semanticGraph: { files: [], flows: [], relations: [] }
    },
    { files: [], flows: [], relations: [] }
  );

  assert.equal(result.validationStatus, "validated_ai");
  assert.deepEqual(result.flows, []);
}

{
  const result = resolvePrReviewSemanticGraph(
    { graphSchemaVersion: "pr-review-semantic-graph:v2" },
    v2Candidates()
  );

  assert.equal(result.validationStatus, "deterministic_fallback");
  assert.equal(result.fallbackReason, "invalid_ai_graph");
  assert.equal(result.schemaVersion, "pr-review-semantic-graph:v2");
}

{
  const invalidLockedRole = validAnalysis();
  invalidLockedRole.semanticGraph.files[0].roleType = "core_logic";
  const result = resolvePrReviewSemanticGraph(
    invalidLockedRole,
    baseCandidates()
  );

  assert.equal(result.validationStatus, "deterministic_fallback");
  assert.equal(result.fallbackReason, "invalid_ai_graph");
  assert.equal(result.files[0].roleType, "entry");
  assert.deepEqual(result.relations, [
    {
      flowKey: "candidate-flow-1",
      fromFilePath: FILE_A,
      toFilePath: FILE_B,
      relationType: "depends_on",
      source: "rule",
      confidence: 90,
      reason: "relative_import:./user.service"
    }
  ]);
}

for (const invalidRelation of [
  {
    candidateKey: null,
    fromFilePath: FILE_A,
    toFilePath: FILE_A,
    relationType: "depends_on",
    reason: "self edge"
  },
  {
    candidateKey: null,
    fromFilePath: FILE_A,
    toFilePath: "missing.ts",
    relationType: "depends_on",
    reason: "missing endpoint"
  },
  {
    candidateKey: CANDIDATE_RELATION_KEY,
    fromFilePath: FILE_B,
    toFilePath: FILE_A,
    relationType: "depends_on",
    reason: "candidate identity mismatch"
  },
  {
    candidateKey: null,
    fromFilePath: FILE_A,
    toFilePath: FILE_B,
    relationType: "calls_everything",
    reason: "invalid relation type"
  }
]) {
  const analysis = validAnalysis({ relations: [invalidRelation] });
  assert.equal(
    resolvePrReviewSemanticGraph(analysis, baseCandidates()).fallbackReason,
    "invalid_ai_graph"
  );
}

{
  const unknownFile = validAnalysis();
  unknownFile.semanticGraph.files[0].filePath = "missing.ts";
  assert.equal(
    resolvePrReviewSemanticGraph(unknownFile, baseCandidates()).fallbackReason,
    "invalid_ai_graph"
  );
}

{
  const candidates = baseCandidates();
  candidates.relations[0].confidence = 55;
  const result = resolvePrReviewSemanticGraph(validAnalysis(), candidates);
  assert.deepEqual(
    result.relations.map((relation) => relation.source),
    ["ai"]
  );
}

{
  const duplicate = validAnalysis();
  duplicate.semanticGraph.relations.push({
    ...duplicate.semanticGraph.relations[0],
    candidateKey: null
  });
  assert.equal(
    resolvePrReviewSemanticGraph(duplicate, baseCandidates()).fallbackReason,
    "invalid_ai_graph"
  );
}

{
  const result = resolvePrReviewSemanticGraph({}, baseCandidates());
  assert.equal(result.validationStatus, "deterministic_fallback");
  assert.equal(result.fallbackReason, "missing_ai_graph");
  assert.equal(
    resolvePrReviewSemanticGraph(
      { graphSchemaVersion: "pr-review-semantic-graph:v1" },
      baseCandidates()
    ).fallbackReason,
    "invalid_ai_graph"
  );
}

{
  const candidates = largeCandidates();
  const analysis = largeAnalysis(candidates);
  const result = resolvePrReviewSemanticGraph(analysis, candidates);
  const countsByFlow = new Map();
  for (const relation of result.relations) {
    countsByFlow.set(
      relation.flowKey,
      (countsByFlow.get(relation.flowKey) ?? 0) + 1
    );
  }

  assert.equal(result.validationStatus, "validated_ai");
  assert.equal(result.relations.length, 100);
  assert.equal([...countsByFlow.values()].every((count) => count <= 40), true);
  assert.deepEqual(result, resolvePrReviewSemanticGraph(analysis, candidates));
}

function largeCandidates() {
  const files = [];
  const flows = [];
  for (let flowIndex = 1; flowIndex <= 3; flowIndex += 1) {
    const filePaths = [];
    for (let fileIndex = 1; fileIndex <= 25; fileIndex += 1) {
      const filePath = `flow-${flowIndex}/file-${fileIndex}.ts`;
      filePaths.push(filePath);
      files.push({
        filePath,
        roleType: "core_logic",
        confidence: 65,
        evidence: "code_file_fallback",
        roleOverrideAllowed: true
      });
    }
    flows.push({
      key: `candidate-flow-${flowIndex}`,
      title: `Flow ${flowIndex}`,
      filePaths,
      relationKeys: [],
      fallback: false
    });
  }
  return { files, relations: [], flows };
}

function largeAnalysis(candidates) {
  const relationTypes = [
    "depends_on",
    "tests",
    "uses_api",
    "passes_data_to",
    "supports"
  ];
  return {
    graphSchemaVersion: "pr-review-semantic-graph:v1",
    semanticGraph: {
      files: candidates.files.map((file) => ({
        filePath: file.filePath,
        roleType: file.roleType,
        roleReason: "대규모 Graph 제한 fixture"
      })),
      flows: candidates.flows.map((flow) => ({
        candidateKey: flow.key,
        title: flow.title,
        description: "관계 개수 제한을 확인합니다.",
        reviewOrder: [...flow.filePaths]
      })),
      relations: candidates.flows.flatMap((flow) =>
        Array.from({ length: 45 }, (_, index) => ({
          candidateKey: null,
          fromFilePath: flow.filePaths[index % flow.filePaths.length],
          toFilePath: flow.filePaths[(index + Math.floor(index / 5) + 1) % 25],
          relationType: relationTypes[index % relationTypes.length],
          reason: `AI relation ${index + 1}`
        }))
      )
    }
  };
}
