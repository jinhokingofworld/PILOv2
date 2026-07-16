import assert from "node:assert/strict";

const { prioritizePrReviewSemanticGraph } = await import(
  "../../dist/modules/pr-review/pr-review-review-priority.js"
);

function graph({ files, flows, relations = [] }) {
  return {
    schemaVersion: 1,
    files,
    flows,
    relations,
    validationStatus: "deterministic_fallback",
    fallbackReason: "missing_ai_graph"
  };
}

function file(filePath, roleType) {
  return { filePath, roleType, roleReason: "test" };
}

function flow(candidateKey, reviewOrder) {
  return {
    candidateKey,
    title: candidateKey,
    description: "test",
    reviewOrder
  };
}

function relation(flowKey, fromFilePath, toFilePath, relationType) {
  return {
    flowKey,
    fromFilePath,
    toFilePath,
    relationType,
    source: "rule",
    confidence: 100,
    reason: "test"
  };
}

const relationshipFirst = prioritizePrReviewSemanticGraph(
  graph({
    files: [
      file("controller.ts", "entry"),
      file("service.ts", "core_logic"),
      file("contract.ts", "api_contract"),
      file("service.spec.ts", "verification"),
      file("README.md", "support")
    ],
    flows: [
      flow("flow-1", [
        "controller.ts",
        "service.ts",
        "contract.ts",
        "service.spec.ts",
        "README.md"
      ])
    ],
    relations: [
      relation("flow-1", "controller.ts", "service.ts", "depends_on"),
      relation("flow-1", "service.ts", "contract.ts", "depends_on"),
      relation("flow-1", "service.spec.ts", "service.ts", "tests"),
      relation("flow-1", "README.md", "service.ts", "supports")
    ]
  }),
  [
    { filePath: "controller.ts", riskLevel: "high" },
    { filePath: "service.ts", riskLevel: "high" },
    { filePath: "contract.ts", riskLevel: "low" },
    { filePath: "service.spec.ts", riskLevel: "medium" },
    { filePath: "README.md", riskLevel: "high" }
  ]
);

assert.deepEqual(relationshipFirst.flows[0].reviewOrder, [
  "contract.ts",
  "service.ts",
  "controller.ts",
  "README.md",
  "service.spec.ts"
]);

const riskThenRole = prioritizePrReviewSemanticGraph(
  graph({
    files: [
      file("medium-contract.ts", "api_contract"),
      file("high-core.ts", "core_logic"),
      file("high-contract.ts", "api_contract"),
      file("high-contract-second.ts", "api_contract")
    ],
    flows: [
      flow("flow-1", [
        "medium-contract.ts",
        "high-core.ts",
        "high-contract.ts",
        "high-contract-second.ts"
      ])
    ]
  }),
  [
    { filePath: "medium-contract.ts", riskLevel: "medium" },
    { filePath: "high-core.ts", riskLevel: "high" },
    { filePath: "high-contract.ts", riskLevel: "high" },
    { filePath: "high-contract-second.ts", riskLevel: "high" }
  ]
);

assert.deepEqual(riskThenRole.flows[0].reviewOrder, [
  "high-contract.ts",
  "high-contract-second.ts",
  "high-core.ts",
  "medium-contract.ts"
]);

const dataFlowFirst = prioritizePrReviewSemanticGraph(
  graph({
    files: [file("producer.ts", "core_logic"), file("consumer.ts", "entry")],
    flows: [flow("flow-1", ["consumer.ts", "producer.ts"])],
    relations: [
      relation("flow-1", "producer.ts", "consumer.ts", "passes_data_to")
    ]
  }),
  [
    { filePath: "producer.ts", riskLevel: "low" },
    { filePath: "consumer.ts", riskLevel: "high" }
  ]
);

assert.deepEqual(dataFlowFirst.flows[0].reviewOrder, [
  "producer.ts",
  "consumer.ts"
]);

const flowPriority = prioritizePrReviewSemanticGraph(
  graph({
    files: [file("medium.ts", "api_contract"), file("high.ts", "support")],
    flows: [flow("medium-flow", ["medium.ts"]), flow("high-flow", ["high.ts"])]
  }),
  [
    { filePath: "medium.ts", riskLevel: "medium" },
    { filePath: "high.ts", riskLevel: "high" }
  ]
);

assert.deepEqual(
  flowPriority.flows.map((value) => value.candidateKey),
  ["high-flow", "medium-flow"]
);

const cyclicGraph = prioritizePrReviewSemanticGraph(
  graph({
    files: [file("a.ts", "core_logic"), file("b.ts", "core_logic")],
    flows: [flow("flow-1", ["a.ts", "b.ts"])],
    relations: [
      relation("flow-1", "a.ts", "b.ts", "depends_on"),
      relation("flow-1", "b.ts", "a.ts", "depends_on")
    ]
  }),
  [
    { filePath: "a.ts", riskLevel: "high" },
    { filePath: "b.ts", riskLevel: "medium" }
  ]
);

assert.deepEqual(cyclicGraph.flows[0].reviewOrder, ["a.ts", "b.ts"]);

const aiOrderWithRelationshipGuard = prioritizePrReviewSemanticGraph(
  {
    ...graph({
      files: [
        file("controller.ts", "entry"),
        file("service.ts", "core_logic"),
        file("readme.md", "support")
      ],
      flows: [flow("flow-1", ["controller.ts", "readme.md", "service.ts"])],
      relations: [
        relation("flow-1", "controller.ts", "service.ts", "depends_on")
      ]
    }),
    validationStatus: "validated_ai",
    fallbackReason: null
  },
  [
    { filePath: "controller.ts", riskLevel: "high" },
    { filePath: "service.ts", riskLevel: "low" },
    { filePath: "readme.md", riskLevel: "high" }
  ]
);

assert.deepEqual(aiOrderWithRelationshipGuard.flows[0].reviewOrder, [
  "readme.md",
  "service.ts",
  "controller.ts"
]);

const aiOrderWithoutRelationshipOverride = prioritizePrReviewSemanticGraph(
  {
    ...graph({
      files: [file("high.ts", "core_logic"), file("low.ts", "support")],
      flows: [flow("flow-1", ["low.ts", "high.ts"])]
    }),
    validationStatus: "validated_ai",
    fallbackReason: null
  },
  [
    { filePath: "high.ts", riskLevel: "high" },
    { filePath: "low.ts", riskLevel: "low" }
  ]
);

assert.deepEqual(aiOrderWithoutRelationshipOverride.flows[0].reviewOrder, [
  "low.ts",
  "high.ts"
]);
