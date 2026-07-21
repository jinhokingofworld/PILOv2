import { Injectable } from "@nestjs/common";
import {
  getAgentToolDomainAndOperation,
  type AgentToolOperation
} from "./agent-tool-capability-catalog";

/**
 * Domain rollout is deliberately independent from the global retrieval mode.
 * Dev fails closed to the rollout encoded in Terraform even while an ECS task
 * definition is being replaced. Other environments preserve the historical
 * registry when a flag is absent.
 */
@Injectable()
export class AgentDomainFeatureFlagService {
  isToolEnabled(toolName: string): boolean {
    const descriptor = getAgentToolDomainAndOperation(toolName);
    return !descriptor || this.isEnabled(descriptor.domain, descriptor.operation);
  }

  isEnabled(domain: string, operation: AgentToolOperation): boolean {
    const value = process.env[this.environmentKey(domain, operation)];
    if (value === undefined) {
      if (process.env.APP_ENV?.trim().toLowerCase() === "dev") {
        return domain === "meeting";
      }
      return true;
    }
    return value.trim().toLowerCase() === "true";
  }

  environmentKey(domain: string, operation: AgentToolOperation): string {
    return `AGENT_DOMAIN_${domain.toUpperCase().replaceAll("-", "_")}_${operation.toUpperCase()}_ENABLED`;
  }
}
