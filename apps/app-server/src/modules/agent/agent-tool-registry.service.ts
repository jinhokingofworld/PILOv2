import { Injectable } from "@nestjs/common";
import type { AgentToolDefinition } from "./types/agent-tool.types";

@Injectable()
export class AgentToolRegistryService {
  private readonly definitions = new Map<string, AgentToolDefinition<unknown>>();

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [...this.definitions.values()];
  }

  getDefinition(name: string): AgentToolDefinition<unknown> | null {
    return this.definitions.get(name) ?? null;
  }
}
