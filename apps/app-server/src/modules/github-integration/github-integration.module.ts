import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { GithubAppClient } from "./github-app.client";
import { GithubAppInstallationStateService } from "./github-app-installation-state.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubIntegrationController } from "./github-integration.controller";
import { GithubIntegrationService } from "./github-integration.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [GithubIntegrationController],
  providers: [
    GithubIntegrationService,
    GithubIntegrationConfigService,
    GithubAppClient,
    GithubAppInstallationStateService,
    GithubOAuthClient,
    GithubOAuthStateService,
    GithubTokenEncryptionService
  ],
  exports: [GithubIntegrationService]
})
export class GithubIntegrationModule {}
