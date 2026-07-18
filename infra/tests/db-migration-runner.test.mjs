import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  runner,
  dockerfile,
  baseline099,
  moduleSource,
  devSource,
  publisherScript,
  operatorScript,
  migration100,
] =
  await Promise.all([
    readFile(new URL("../db-migrations/run-migrations.sh", import.meta.url), "utf8"),
    readFile(new URL("../db-migrations/Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../db-migrations/baselines/099.sql", import.meta.url), "utf8"),
    readFile(new URL("../modules/db-migrations/main.tf", import.meta.url), "utf8"),
    readFile(new URL("../envs/dev/main.tf", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/publish-dev-db-migration-runner.ps1", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../scripts/run-dev-db-migrations.ps1", import.meta.url), "utf8"),
    readFile(
      new URL("../../db/migrations/100_fix_canvas_agent_pgcrypto_digest_schema.sql", import.meta.url),
      "utf8",
    ),
  ]);

assert.match(runner, /pilo_migrations\.schema_migrations/);
assert.match(runner, /sha256sum/);
assert.match(runner, /pg_advisory_xact_lock/);
assert.match(runner, /CONFIRM_BASELINE=RDS_SCHEMA_VERIFIED/);
assert.match(runner, /execution_mode IN \('baseline', 'applied'\)/);
assert.match(runner, /runner-managed migration must not contain transaction control/);
assert.match(runner, /has_top_level_transaction_control/);
assert.match(runner, /history contains versions missing from the runner bundle/);
assert.match(runner, /runner image revision does not match MIGRATION_SOURCE_REVISION/);
assert.match(runner, /baseline verification SQL not found/);
assert.match(dockerfile, /COPY db\/migrations \/opt\/pilo\/migrations/);
assert.match(dockerfile, /COPY infra\/db-migrations\/baselines \/opt\/pilo\/baselines/);
assert.match(dockerfile, /ARG SOURCE_REVISION=unknown/);
assert.match(dockerfile, /USER postgres/);
assert.match(baseline099, /public\.agent_candidate_selections/);
assert.match(baseline099, /public\.digest\(text,text\)/);
assert.match(moduleSource, /family\s+=\s+"\$\{var\.name_prefix\}-db-migrations"/);
assert.match(moduleSource, /valueFrom = "\$\{var\.database_secret_arn\}:username::"/);
assert.match(devSource, /"pilo-db-migrations"/);
assert.match(devSource, /module "db_migrations"/);
assert.match(publisherScript, /Commit db\/migrations and infra\/db-migrations/);
assert.match(operatorScript, /ValidateSet\("apply", "baseline"\)/);
assert.match(operatorScript, /\$awsCommand ecs wait tasks-stopped/);
assert.match(migration100, /public\.digest\(/);
assert.doesNotMatch(migration100, /extensions\.digest\(/);

console.log("DB migration runner infrastructure is verified.");
