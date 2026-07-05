import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { GithubTokenEncryptionService } from "../github-integration/github-token-encryption.service";
import { AuthConfigService } from "./auth-config.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { GithubLoginOAuthClient } from "./github-login-oauth.client";
import { GoogleOAuthClient } from "./google-oauth.client";
import { OAuthStateService } from "./oauth-state.service";

@Module({
  imports: [CommonModule, DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthConfigService,
    OAuthStateService,
    GoogleOAuthClient,
    GithubLoginOAuthClient,
    GithubTokenEncryptionService
  ]
})
export class AuthModule {}
