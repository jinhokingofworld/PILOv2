import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { unauthorized } from "./api-error";

export interface AuthenticatedRequest {
  headers: {
    authorization?: string | string[];
  };
  currentUserId?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = this.getAuthorizationHeader(request);

    if (!authorization) {
      throw unauthorized("Missing bearer token");
    }

    const parts = authorization.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      throw unauthorized("Invalid bearer token");
    }

    const currentUserId = this.extractCurrentUserId(parts[1]);
    if (!currentUserId) {
      throw unauthorized("Invalid bearer token subject");
    }

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

  private extractCurrentUserId(token: string): string | null {
    return UUID_PATTERN.test(token) ? token : null;
  }
}
