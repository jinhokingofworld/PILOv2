import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentInputRelationshipService } = require(
  "../../dist/modules/agent/agent-input-relationship.service.js"
);

if (!process.env.OPENAI_API_KEY?.trim()) {
  throw new Error("OPENAI_API_KEY is required for the relationship evaluation");
}

const fixtures = JSON.parse(
  await readFile(
    new URL("./fixtures/input-relationship-evaluation.json", import.meta.url),
    "utf8"
  )
);
const service = new AgentInputRelationshipService();
let correct = 0;
let unsafeDestructiveDecisions = 0;
const failures = [];

function effectiveRelationship(decision, runStatus) {
  if (
    runStatus === "waiting_confirmation" &&
    decision.relationship === "continuation"
  ) {
    return "ambiguous";
  }
  if (
    decision.relationship === "continuation" &&
    decision.confidence === "low"
  ) {
    return "ambiguous";
  }
  if (
    decision.relationship === "cancel" &&
    decision.confidence !== "high"
  ) {
    return "ambiguous";
  }
  return decision.relationship;
}

for (const fixture of fixtures) {
  const runStatus = fixture.runStatus ?? "waiting_user_input";
  const decision = await service.classify({
    originalGoal: fixture.question,
    latestAssistantQuestion: fixture.question,
    waitingInputKind:
      fixture.waitingInputKind ??
      (runStatus === "waiting_confirmation"
        ? "confirmation"
        : "clarification"),
    timeline: [{ role: "assistant", content: fixture.question }],
    newMessage: fixture.message,
    requestSurface: fixture.requestSurface ?? null,
    hasCandidates: fixture.hasCandidates ?? false,
    candidateTypes: fixture.candidateTypes ?? [],
    runStatus
  });
  const effective = effectiveRelationship(decision, runStatus);
  if (effective === fixture.relationship) {
    correct += 1;
  } else {
    failures.push({
      name: fixture.name,
      expected: fixture.relationship,
      actual: effective,
      raw: decision.relationship,
      confidence: decision.confidence
    });
  }
  if (
    (effective === "new_intent" || effective === "cancel") &&
    effective !== fixture.relationship
  ) {
    unsafeDestructiveDecisions += 1;
  }
}

const accuracy = fixtures.length === 0 ? 0 : correct / fixtures.length;
console.log(
  JSON.stringify(
    {
      model:
        process.env.OPENAI_AGENT_RELATIONSHIP_MODEL ??
        process.env.OPENAI_AGENT_ROUTER_MODEL ??
        process.env.OPENAI_AGENT_PLANNER_MODEL ??
        "default",
      caseCount: fixtures.length,
      correct,
      accuracy,
      unsafeDestructiveDecisions,
      failures
    },
    null,
    2
  )
);

if (accuracy < 0.9 || unsafeDestructiveDecisions > 0) {
  process.exitCode = 1;
}
