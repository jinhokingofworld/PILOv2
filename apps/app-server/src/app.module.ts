import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { GithubIntegrationModule } from "./modules/github-integration/github-integration.module";

@Module({
  imports: [GithubIntegrationModule],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
