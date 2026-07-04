import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { unauthorized } from "./api-error";
import { SessionService } from "./session.service";

export interface AuthenticatedRequest {
  headers: {
    authorization?: string | string[];
  };
  currentUserId?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = this.getAuthorizationHeader(request);

    if (!authorization) {
      throw unauthorized("Missing bearer token");
    }

    const parts = authorization.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      throw unauthorized("Invalid bearer token");
    }

    const currentUserId = await this.sessionService.validateSessionToken(parts[1]);

    request.currentUserId = currentUserId;
    return true;
  }

  private getAuthorizationHeader(request: AuthenticatedRequest): string | null {
    const authorization = request.headers.authorization;
    if (Array.isArray(authorization)) {
      return authorization[0] ?? null;
    }

    return authorization ?? null;
  }
}
