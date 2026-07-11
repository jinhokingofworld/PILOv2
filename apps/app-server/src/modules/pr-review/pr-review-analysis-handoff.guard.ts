import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

interface PrReviewAnalysisHandoffRequest {
  headers: {
    "x-pr-review-analysis-worker-token"?: string | string[];
  };
}

@Injectable()
export class PrReviewAnalysisHandoffGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const expectedToken = process.env.PR_REVIEW_ANALYSIS_WORKER_TOKEN?.trim();
    if (!expectedToken) {
      throw new ServiceUnavailableException("PR Review analysis handoff is unavailable");
    }

    const request = context
      .switchToHttp()
      .getRequest<PrReviewAnalysisHandoffRequest>();
    const providedToken = this.readToken(request);

    if (!providedToken || !this.tokensMatch(providedToken, expectedToken)) {
      throw new UnauthorizedException("Invalid PR Review analysis worker token");
    }

    return true;
  }

  private readToken(request: PrReviewAnalysisHandoffRequest): string | null {
    const token = request.headers["x-pr-review-analysis-worker-token"];
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
