import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

interface AgentExecutionHandoffRequest {
  headers: {
    "x-agent-execution-handoff-token"?: string | string[];
  };
}

@Injectable()
export class AgentExecutionHandoffGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const expectedToken = process.env.AGENT_EXECUTION_HANDOFF_TOKEN?.trim();
    if (!expectedToken) {
      throw new ServiceUnavailableException("Agent execution handoff is unavailable");
    }

    const request = context
      .switchToHttp()
      .getRequest<AgentExecutionHandoffRequest>();
    const providedToken = this.readToken(request);

    if (!providedToken || !this.tokensMatch(providedToken, expectedToken)) {
      throw new UnauthorizedException("Invalid Agent execution handoff token");
    }

    return true;
  }

  private readToken(request: AgentExecutionHandoffRequest): string | null {
    const token = request.headers["x-agent-execution-handoff-token"];
    if (Array.isArray(token)) {
      return token[0]?.trim() || null;
    }

    return token?.trim() || null;
  }

  private tokensMatch(providedToken: string, expectedToken: string): boolean {
    const provided = Buffer.from(providedToken, "utf8");
    const expected = Buffer.from(expectedToken, "utf8");

    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
}
