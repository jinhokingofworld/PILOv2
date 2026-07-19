import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { embedGroundingQuery } = require(
  "../../dist/modules/agent/grounding/query-embedding.js"
);
const {
  driveRagMinimumSimilarity,
  meetingRagMinimumSimilarity
} = require("../../dist/modules/agent/grounding/relevance-policy.js");

const fixtureUrl = new URL("./fixtures/rag-relevance-evaluation.json", import.meta.url);
const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8"));
let failed = false;

for (const [domain, cases] of Object.entries(fixtures)) {
  const evaluated = [];
  for (const item of cases) {
    const [queryVector, candidateVector] = await Promise.all([
      embedGroundingQuery(item.query),
      embedGroundingQuery(item.candidate)
    ]);
    evaluated.push({ label: item.label, score: cosineSimilarity(queryVector, candidateVector) });
  }

  const relevantScores = evaluated.filter((item) => item.label === "relevant").map((item) => item.score);
  const irrelevantScores = evaluated.filter((item) => item.label === "irrelevant").map((item) => item.score);
  const minimumRelevantScore = Math.min(...relevantScores);
  const maximumIrrelevantScore = Math.max(...irrelevantScores);
  const suggestedThreshold = round(maximumIrrelevantScore + 0.01);
  const configuredThreshold = domain === "meeting"
    ? meetingRagMinimumSimilarity()
    : driveRagMinimumSimilarity();
  const valid =
    relevantScores.length > 0 &&
    irrelevantScores.length > 0 &&
    suggestedThreshold <= 1 &&
    relevantScores.every((score) => score >= suggestedThreshold) &&
    irrelevantScores.every((score) => score < suggestedThreshold) &&
    relevantScores.every((score) => score >= configuredThreshold) &&
    irrelevantScores.every((score) => score < configuredThreshold);

  console.log(JSON.stringify({
    domain,
    minimumRelevantScore: round(minimumRelevantScore),
    maximumIrrelevantScore: round(maximumIrrelevantScore),
    suggestedThreshold,
    configuredThreshold,
    valid
  }));
  failed ||= !valid;
}

if (failed) process.exitCode = 1;

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
