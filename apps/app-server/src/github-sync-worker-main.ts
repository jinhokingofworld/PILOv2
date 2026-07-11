import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { GithubSyncJobService } from "./modules/github-integration/github-sync-job.service";

async function bootstrap(): Promise<void> {
  process.env.APP_SERVER_RUNTIME = "github-sync-worker";
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const worker = app.get(GithubSyncJobService);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  while (!stopping) await worker.pollOnce();
  await app.close();
}
void bootstrap();
