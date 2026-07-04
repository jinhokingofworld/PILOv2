import { Module } from "@nestjs/common";
import { GithubIntegrationController } from "./github-integration.controller";
import { GithubIntegrationService } from "./github-integration.service";

@Module({
  controllers: [GithubIntegrationController],
  providers: [GithubIntegrationService],
  exports: [GithubIntegrationService]
})
export class GithubIntegrationModule {}
