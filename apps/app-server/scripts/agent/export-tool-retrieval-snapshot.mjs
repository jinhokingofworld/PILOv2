import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentToolRegistryService } = require(
  "../../dist/modules/agent/agent-tool-registry.service.js"
);
const {
  buildAgentToolCapabilityCatalog
} = require("../../dist/modules/agent/agent-tool-capability-catalog.js");
const { CalendarAgentToolsService } = require(
  "../../dist/modules/agent/tools/calendar-agent-tools.service.js"
);
const { MeetingAgentToolsService } = require(
  "../../dist/modules/agent/tools/meeting-agent-tools.service.js"
);
const { BoardAgentToolsService } = require(
  "../../dist/modules/agent/tools/board-agent-tools.service.js"
);
const { SqlErdAgentToolsService } = require(
  "../../dist/modules/agent/tools/sql-erd-agent-tools.service.js"
);
const { DriveAgentToolsService } = require(
  "../../dist/modules/agent/tools/drive-agent-tools.service.js"
);
const { PrReviewAgentToolsService } = require(
  "../../dist/modules/agent/tools/pr-review-agent-tools.service.js"
);
const { CanvasAgentDelegationToolsService } = require(
  "../../dist/modules/agent/tools/canvas-agent-delegation-tools.service.js"
);

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (!outputPath) {
  throw new Error("--output is required");
}

const registry = new AgentToolRegistryService(
  new CalendarAgentToolsService({}),
  new MeetingAgentToolsService({}),
  new BoardAgentToolsService({}),
  new SqlErdAgentToolsService({}),
  new PrReviewAgentToolsService({}),
  new CanvasAgentDelegationToolsService({}, {}),
  new DriveAgentToolsService({})
);
const definitions = registry
  .listDefinitions()
  .sort((left, right) => left.name.localeCompare(right.name));
const eligibleToolSchemas = Object.fromEntries(
  definitions.map((definition) => [definition.name, definition.inputSchema])
);
const toolCapabilityCatalog = buildAgentToolCapabilityCatalog(definitions);
const snapshot = {
  format: "agent-tool-retrieval-registry-snapshot:v1",
  inventory: registry.listToolInventory(),
  eligibleSnapshotSha256: canonicalSha256(eligibleToolSchemas),
  eligibleToolSchemas,
  toolCapabilityCatalog
};

const resolvedOutputPath = resolve(outputPath);
mkdirSync(dirname(resolvedOutputPath), { recursive: true });
writeFileSync(resolvedOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`);

function canonicalSha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}
