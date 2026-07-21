# PILO DB Migration Runner

This image is the only supported path for applying new `db/migrations/*.sql`
files to the shared RDS database.

## Guarantees

- numbered files are read in ascending order;
- SHA-256 checksums are verified for every previously recorded file;
- `pilo_migrations.schema_migrations` records baseline and applied files;
- a PostgreSQL advisory lock prevents concurrent runners from applying the
  same version;
- a new migration and its history row commit in the same transaction;
- the container has no AWS task role and receives only the RDS connection
  fields required by `psql`.

## Initial RDS baseline

The RDS database was restored before this runner existed. After the restored
schema is verified, record the existing files without executing them:

```powershell
./infra/scripts/run-dev-db-migrations.ps1 `
  -Mode baseline `
  -BaselineThrough 099 `
  -ConfirmBaseline RDS_SCHEMA_VERIFIED `
  -ImageTag <dev-merge-commit-sha>
```

The confirmation value is intentionally exact. Baseline mode must never be
used on an empty or partially restored database. Before writing history, the
runner also executes `baselines/099.sql` and stops if the restored schema's
required migration-099 anchors are missing.

Provision the ECR repository and ECS task only with reviewed dev variables.
Do not run an unreviewed full `terraform apply`: omitted DNS and GitHub inputs
can produce unrelated destructive changes. The reviewed bootstrap plan must
target only `module.ecr` and `module.db_migrations`, and must show four creates,
zero updates, and zero destroys. Publish the runner image after ECR exists and
before executing baseline mode.

## Applying later migrations

### Immutable migration policy

Treat a migration as immutable as soon as it is merged to `main` or recorded
by a shared database. A later schema or permission correction must be a new,
next-numbered migration. Do not edit an old file to repair it, even when the
old migration has not yet been executed by the current RDS environment: the
same file can already be the canonical version for another environment or
release branch.

If an existing migration is changed accidentally before release, restore the
canonical file and create a new migration for the intended change. The CI
checksum check is deliberately designed to reject the old-file edit.

### Temporary migration-104 recovery

Issue #1637 permits only the exact migration-104 checksum transition while
the corrected file is promoted from dev to main. The exception must be removed
in a follow-up change after that promotion; it is not a permanent repair
mechanism and does not authorize a new RDS migration execution. The policy
test also fails once `main` contains the corrected checksum, so the follow-up
must remove the exception files and restore the ordinary always-immutable
check before further delivery work proceeds.

The `Publish DB Migration Runner` workflow validates migration filenames and
immutability on pull requests. When a matching change is merged to `dev`, it
publishes a runner image with the full merge commit SHA and `latest` tags.
The workflow can push only to this ECR repository; it cannot read the RDS
secret or start an ECS task.

After the publisher role has been applied, register its Terraform output as the
repository variable `AWS_DB_MIGRATION_PUBLISH_ROLE_ARN`. Each operator then
runs the exact image reviewed in the dev merge. The script resolves the tag to
an ECR digest, registers a one-off task definition revision, and runs that
revision. It never executes the mutable `latest` tag. If no migration merge
has happened after the variable is registered, run `Publish DB Migration
Runner` manually on the `dev` branch once to publish the current runner image.

```powershell
./infra/scripts/run-dev-db-migrations.ps1 `
  -Mode apply `
  -ImageTag <dev-merge-commit-sha>
```

The operator needs ECS task execution permission. Team members using the
existing AdministratorAccess role already have it; they do not need the RDS
password or direct database network access.

Runner-managed files after the baseline must not contain `BEGIN`, `COMMIT`,
`ROLLBACK`, or `psql` meta-commands. The runner owns the transaction so the SQL
change and history record cannot diverge.

## Local integration test

With Docker Desktop running:

```powershell
./infra/tests/db-migration-runner.integration.ps1
```

The test uses an isolated PostgreSQL container to verify baseline recording,
atomic application, idempotent reruns, and checksum-tampering rejection.

The Canvas Agent pgcrypto correction has a separate trigger-level test:

```powershell
./infra/tests/canvas-agent-pgcrypto-migration.integration.ps1
```
