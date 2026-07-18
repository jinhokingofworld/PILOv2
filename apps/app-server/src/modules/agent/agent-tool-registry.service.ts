import { Injectable } from "@nestjs/common";
import { BoardAgentToolsService } from "./tools/board-agent-tools.service";
import { CalendarAgentToolsService } from "./tools/calendar-agent-tools.service";
import { MeetingAgentToolsService } from "./tools/meeting-agent-tools.service";
import { SqlErdAgentToolsService } from "./tools/sql-erd-agent-tools.service";
import { PrReviewAgentToolsService } from "./tools/pr-review-agent-tools.service";
import { CanvasAgentDelegationToolsService } from "./tools/canvas-agent-delegation-tools.service";
import { DriveAgentToolsService } from "./tools/drive-agent-tools.service";
import {
  buildAgentToolCapabilityCatalog,
  type AgentToolCapabilityCatalogSnapshot
} from "./agent-tool-capability-catalog";
import {
  buildAgentToolInventory,
  type AgentToolInventorySnapshot
} from "./agent-tool-inventory";
import type {
  AgentRunRequestContext,
  AgentToolDefinition
} from "./types/agent-tool.types";

@Injectable()
export class AgentToolRegistryService {
  private readonly definitions = new Map<string, AgentToolDefinition<unknown>>();

  constructor(
    calendarAgentToolsService?: CalendarAgentToolsService,
    meetingAgentToolsService?: MeetingAgentToolsService,
    boardAgentToolsService?: BoardAgentToolsService,
    sqlErdAgentToolsService?: SqlErdAgentToolsService,
    prReviewAgentToolsService?: PrReviewAgentToolsService,
    canvasAgentDelegationToolsService?: CanvasAgentDelegationToolsService,
    driveAgentToolsService?: DriveAgentToolsService
  ) {
    if (calendarAgentToolsService) {
      this.registerMany(calendarAgentToolsService.listDefinitions());
    }

    if (meetingAgentToolsService) {
      this.registerMany(meetingAgentToolsService.listDefinitions());
    }

    if (boardAgentToolsService) {
      this.registerMany(boardAgentToolsService.listDefinitions());
    }

    if (sqlErdAgentToolsService) {
      this.registerMany(sqlErdAgentToolsService.listDefinitions());
    }

    if (prReviewAgentToolsService) {
      this.registerMany(prReviewAgentToolsService.listDefinitions());
    }

    if (canvasAgentDelegationToolsService) {
      this.registerMany(canvasAgentDelegationToolsService.listDefinitions());
    }

    if (driveAgentToolsService) {
      this.registerMany(driveAgentToolsService.listDefinitions());
    }
  }

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [...this.definitions.values()];
  }

  listToolInventory(): AgentToolInventorySnapshot {
    return buildAgentToolInventory(this.listDefinitions());
  }

  listDefinitionsForContext(
    requestContext: AgentRunRequestContext
  ): AgentToolDefinition<unknown>[] {
    return this.listDefinitions().filter((definition) =>
      this.isAvailableForContext(definition, requestContext)
    );
  }

  listCapabilityCatalogForContext(
    requestContext: AgentRunRequestContext
  ): AgentToolCapabilityCatalogSnapshot {
    return buildAgentToolCapabilityCatalog(
      this.listDefinitionsForContext(requestContext)
    );
  }

  listToolInventoryForContext(
    requestContext: AgentRunRequestContext
  ): AgentToolInventorySnapshot {
    return buildAgentToolInventory(this.listDefinitionsForContext(requestContext));
  }

  getDefinition(name: string): AgentToolDefinition<unknown> | null {
    return this.definitions.get(name) ?? null;
  }

  getDefinitionForContext(
    name: string,
    requestContext: AgentRunRequestContext
  ): AgentToolDefinition<unknown> | null {
    const definition = this.getDefinition(name);
    return definition && this.isAvailableForContext(definition, requestContext)
      ? definition
      : null;
  }

  private isAvailableForContext(
    definition: AgentToolDefinition<unknown>,
    requestContext: AgentRunRequestContext
  ): boolean {
    return (
      !definition.contextRequirement ||
      definition.contextRequirement.surface === requestContext?.surface
    );
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
