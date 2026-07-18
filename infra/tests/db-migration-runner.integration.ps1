param(
  [string] $ImageName = "pilo-db-migrations:integration-test"
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$fixtureRoot = Resolve-Path (
  Join-Path $scriptRoot "fixtures\db-migration-runner"
)
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 10)
$networkName = "pilo-migration-test-$suffix"
$postgresName = "pilo-migration-postgres-$suffix"
$password = "pilo-migration-test"

function Invoke-DockerMigration {
  param(
    [ValidateSet("baseline", "apply")]
    [string] $Mode,
    [string] $MigrationsDirectory = "/fixtures/migrations"
  )

  $arguments = @(
    "run", "--rm",
    "--network", $networkName,
    "--env", "PGHOST=$postgresName",
    "--env", "PGPORT=5432",
    "--env", "PGDATABASE=pilo",
    "--env", "PGUSER=postgres",
    "--env", "PGPASSWORD=$password",
    "--env", "PGSSLMODE=disable",
    "--env", "MIGRATION_MODE=$Mode",
    "--env", "MIGRATION_SOURCE_REVISION=integration-test",
    "--env", "MIGRATIONS_DIR=$MigrationsDirectory",
    "--mount", "type=bind,source=$fixtureRoot,target=/fixtures,readonly"
  )

  if ($Mode -eq "baseline") {
    $arguments += @(
      "--env", "BASELINE_THROUGH=002",
      "--env", "CONFIRM_BASELINE=RDS_SCHEMA_VERIFIED",
      "--env", "BASELINE_VERIFY_SQL=/fixtures/baselines/002.sql"
    )
  }

  $arguments += $ImageName
  & docker @arguments | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Migration runner failed in $Mode mode."
  }
}

try {
  & docker build `
    --file (Join-Path $repoRoot "infra\db-migrations\Dockerfile") `
    --build-arg "SOURCE_REVISION=integration-test" `
    --tag $ImageName `
    $repoRoot | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Migration runner image build failed."
  }

  & docker network create $networkName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker test network creation failed."
  }

  & docker run --detach `
    --name $postgresName `
    --network $networkName `
    --env "POSTGRES_DB=pilo" `
    --env "POSTGRES_PASSWORD=$password" `
    postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL test container failed to start."
  }

  $postgresReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & docker exec $postgresName psql `
      --username postgres `
      --dbname pilo `
      --tuples-only `
      --command "SELECT 1;" 2>&1 | Out-Null
    $readyExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($readyExitCode -eq 0) {
      $postgresReady = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $postgresReady) {
    throw "PostgreSQL test container did not become ready."
  }

  & docker exec $postgresName psql `
    --username postgres `
    --dbname pilo `
    --set ON_ERROR_STOP=1 `
    --command "CREATE TABLE public.restored_marker (id INTEGER PRIMARY KEY, label TEXT);" |
    Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Restored schema fixture setup failed."
  }

  Invoke-DockerMigration -Mode baseline
  Invoke-DockerMigration -Mode apply
  Invoke-DockerMigration -Mode apply

  $history = (& docker exec $postgresName psql `
    --username postgres `
    --dbname pilo `
    --tuples-only `
    --no-align `
    --command "SELECT string_agg(version || ':' || execution_mode, ',' ORDER BY version) FROM pilo_migrations.schema_migrations;").Trim()
  if ($history -ne "1:baseline,2:baseline,3:applied,4:applied") {
    throw "Unexpected migration history: $history"
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & docker run --rm `
    --network $networkName `
    --env "PGHOST=$postgresName" `
    --env "PGPORT=5432" `
    --env "PGDATABASE=pilo" `
    --env "PGUSER=postgres" `
    --env "PGPASSWORD=$password" `
    --env "PGSSLMODE=disable" `
    --env "MIGRATION_MODE=apply" `
    --env "MIGRATION_SOURCE_REVISION=integration-test" `
    --env "MIGRATIONS_DIR=/fixtures/tampered" `
    --mount "type=bind,source=$fixtureRoot,target=/fixtures,readonly" `
    $ImageName 2>&1 | Out-Host
  $tamperedExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($tamperedExitCode -eq 0) {
    throw "Tampered migration checksum was not rejected."
  }

  Write-Host "DB migration runner integration test passed."
}
finally {
  & docker rm --force $postgresName 2>$null | Out-Null
  & docker network rm $networkName 2>$null | Out-Null
}
