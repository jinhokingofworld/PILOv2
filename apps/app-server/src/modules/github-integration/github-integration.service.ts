import { Injectable } from "@nestjs/common";
import type { GitHubIntegrationModuleInfo } from "./types";

@Injectable()
export class GithubIntegrationService {
  getModuleInfo(): GitHubIntegrationModuleInfo {
    return {
      domain: "github-integration",
      apiContract: "docs/api/github-integration-api.md"
    };
  }
}
