import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentInputRelationshipService } = require(
  "../../dist/modules/agent/agent-input-relationship.service.js"
);

const cases = JSON.parse(
  await readFile(
    new URL("./fixtures/input-relationship-evaluation.json", import.meta.url),
    "utf8"
  )
);
const previousFetch = globalThis.fetch;
const previousApiKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "test-key";

try {
  for (const fixture of cases) {
    let requestBody;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    relationship: fixture.relationship,
                    confidence:
                      fixture.relationship === "ambiguous" ? "low" : "high",
                    reason: `${fixture.name} 관계 분류`,
                    clarificationQuestion:
                      fixture.relationship === "ambiguous"
                        ? "기존 작업을 이어갈까요, 아니면 새 요청을 시작할까요?"
                        : null
                  })
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const decision = await new AgentInputRelationshipService().classify({
      originalGoal: fixture.question,
      latestAssistantQuestion: fixture.question,
      waitingInputKind:
        fixture.waitingInputKind ??
        (fixture.runStatus === "waiting_confirmation"
          ? "confirmation"
          : "clarification"),
      timeline: [{ role: "assistant", content: fixture.question }],
      newMessage: fixture.message,
      requestSurface: fixture.requestSurface ?? null,
      hasCandidates: fixture.hasCandidates ?? false,
      candidateTypes: fixture.candidateTypes ?? [],
      runStatus: fixture.runStatus ?? "waiting_user_input"
    });

    assert.equal(decision.relationship, fixture.relationship, fixture.name);
    assert.equal(requestBody.text.format.type, "json_schema");
    assert.equal(requestBody.text.format.strict, true);
    assert.equal(
      requestBody.text.format.schema.additionalProperties,
      false
    );
    const providerContext = JSON.parse(requestBody.input[1].content);
    assert.equal(providerContext.newMessage, fixture.message);
    assert.equal(
      providerContext.waitingInputKind,
      fixture.waitingInputKind ??
        (fixture.runStatus === "waiting_confirmation"
          ? "confirmation"
          : "clarification")
    );
    assert.equal("resourceId" in providerContext, false);
    assert.equal("toolOutput" in providerContext, false);
    assert.equal("providerPayload" in providerContext, false);
  }
} finally {
  globalThis.fetch = previousFetch;
  if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousApiKey;
}

console.log(
  `agent input relationship provider contract tests passed (${cases.length} Korean contexts)`
);
