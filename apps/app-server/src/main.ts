import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      rawBody: true,
      logger: ["error", "warn", "log"]
    }
  );

  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? "*",
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"]
  });

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
