import { Controller } from "@nestjs/common";
import { GithubIntegrationService } from "./github-integration.service";

@Controller()
export class GithubIntegrationController {
  constructor(private readonly githubIntegrationService: GithubIntegrationService) {}
}
