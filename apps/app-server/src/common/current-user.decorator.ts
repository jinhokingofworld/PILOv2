import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { unauthorized } from "./api-error";
import { AuthenticatedRequest } from "./auth.guard";

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.currentUserId) {
      throw unauthorized("Missing current user");
    }

    return request.currentUserId;
  }
);
