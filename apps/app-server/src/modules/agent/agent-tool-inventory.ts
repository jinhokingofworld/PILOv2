import { createHash } from "node:crypto";
import {
  AGENT_TOOL_CAPABILITY_CATALOG_VERSION,
  buildAgentToolCapabilityCatalog,
  type AgentToolOperation
} from "./agent-tool-capability-catalog";
import type { AgentToolDefinition } from "./types/agent-tool.types";

export const AGENT_TOOL_INVENTORY_VERSION = "agent-tool-inventory:v1";

export interface AgentToolInventoryItem {
  toolName: string;
  domain: string;
  action: string;
  operation: AgentToolOperation;
  riskLevel: AgentToolDefinition<unknown>["riskLevel"];
  executionMode: AgentToolDefinition<unknown>["executionMode"];
  contextSurface: string | null;
  requiredInputFields: string[];
  schemaBytes: number;
  estimatedSchemaTokens: number;
  capabilityIds: string[];
}

export interface AgentToolInventorySnapshot {
  version: string;
  sha256: string;
  catalogVersion: string;
  catalogSha256: string;
  totalTools: number;
  totalSchemaBytes: number;
  totalEstimatedSchemaTokens: number;
  tools: AgentToolInventoryItem[];
}

export function buildAgentToolInventory(
  definitions: AgentToolDefinition<unknown>[]
): AgentToolInventorySnapshot {
  const catalog = buildAgentToolCapabilityCatalog(definitions);
  const descriptorByToolName = new Map(
    catalog.descriptors.map((descriptor) => [descriptor.toolName, descriptor])
  );
  const tools = definitions
    .map((definition) => {
      const descriptor = descriptorByToolName.get(definition.name);
      if (!descriptor) {
        throw new Error(`Agent tool inventory is missing descriptor: ${definition.name}`);
      }
      const schemaBytes = Buffer.byteLength(JSON.stringify(definition.inputSchema));
      const required = definition.inputSchema.required;
      return {
        toolName: definition.name,
        domain: descriptor.domain,
        action: descriptor.action,
        operation: descriptor.operation,
        riskLevel: definition.riskLevel,
        executionMode: definition.executionMode,
        contextSurface: descriptor.contextSurface,
        requiredInputFields: Array.isArray(required)
          ? required.filter((field): field is string => typeof field === "string").sort()
          : [],
        schemaBytes,
        estimatedSchemaTokens: Math.ceil(schemaBytes / 4),
        capabilityIds: [...descriptor.capabilityIds].sort()
      };
    })
    .sort((left, right) => left.toolName.localeCompare(right.toolName));
  const totalSchemaBytes = tools.reduce((total, tool) => total + tool.schemaBytes, 0);
  const totalEstimatedSchemaTokens = tools.reduce(
    (total, tool) => total + tool.estimatedSchemaTokens,
    0
  );
  const canonical = {
    version: AGENT_TOOL_INVENTORY_VERSION,
    catalogVersion: AGENT_TOOL_CAPABILITY_CATALOG_VERSION,
    catalogSha256: catalog.sha256,
    tools
  };

  return {
    version: AGENT_TOOL_INVENTORY_VERSION,
    sha256: hashCanonicalJson(canonical),
    catalogVersion: AGENT_TOOL_CAPABILITY_CATALOG_VERSION,
    catalogSha256: catalog.sha256,
    totalTools: tools.length,
    totalSchemaBytes,
    totalEstimatedSchemaTokens,
    tools
  };
}

function hashCanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}
