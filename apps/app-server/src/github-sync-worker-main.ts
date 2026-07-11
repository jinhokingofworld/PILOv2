import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { GithubSyncJobService } from "./modules/github-integration/github-sync-job.service";
import { GithubSyncWorkerModule } from "./modules/github-integration/github-sync-worker.module";

async function bootstrap(): Promise<void> {
  process.env.APP_SERVER_RUNTIME = "github-sync-worker";
  const app = await NestFactory.createApplicationContext(GithubSyncWorkerModule, { logger: ["error", "warn", "log"] });
  const worker = app.get(GithubSyncJobService);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  while (!stopping) await worker.pollOnce();
  await app.close();
}
void bootstrap();
