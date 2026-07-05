import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubIntegrationController } from "./github-integration.controller";
import { GithubIntegrationService } from "./github-integration.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";

@Module({
  imports: [DatabaseModule],
  controllers: [GithubIntegrationController],
  providers: [
    GithubIntegrationService,
    GithubIntegrationConfigService,
    GithubOAuthClient,
    GithubOAuthStateService,
    GithubTokenEncryptionService
  ],
  exports: [GithubIntegrationService]
})
export class GithubIntegrationModule {}
