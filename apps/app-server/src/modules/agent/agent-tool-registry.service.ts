import { Injectable } from "@nestjs/common";
import { CalendarAgentToolsService } from "./tools/calendar-agent-tools.service";
import { MeetingAgentToolsService } from "./tools/meeting-agent-tools.service";
import type { AgentToolDefinition } from "./types/agent-tool.types";

@Injectable()
export class AgentToolRegistryService {
  private readonly definitions = new Map<string, AgentToolDefinition<unknown>>();

  constructor(
    calendarAgentToolsService?: CalendarAgentToolsService,
    meetingAgentToolsService?: MeetingAgentToolsService
  ) {
    if (calendarAgentToolsService) {
      this.registerMany(calendarAgentToolsService.listDefinitions());
    }

    if (meetingAgentToolsService) {
      this.registerMany(meetingAgentToolsService.listDefinitions());
    }
  }

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [...this.definitions.values()];
  }

  getDefinition(name: string): AgentToolDefinition<unknown> | null {
    return this.definitions.get(name) ?? null;
  }

  private registerMany(definitions: AgentToolDefinition<unknown>[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  private register(definition: AgentToolDefinition<unknown>): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Duplicate Agent tool definition: ${definition.name}`);
    }

    this.definitions.set(definition.name, definition);
  }
}
