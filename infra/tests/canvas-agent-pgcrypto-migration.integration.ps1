$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 10)
$postgresName = "pilo-pgcrypto-test-$suffix"
$password = "pilo-pgcrypto-test"

try {
  & docker run --detach `
    --name $postgresName `
    --env "POSTGRES_DB=pilo" `
    --env "POSTGRES_PASSWORD=$password" `
    --mount "type=bind,source=$repoRoot,target=/workspace,readonly" `
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

  $sqlFiles = @(
    "/workspace/infra/tests/fixtures/canvas-agent-pgcrypto/setup.sql",
    "/workspace/db/migrations/100_fix_canvas_agent_pgcrypto_digest_schema.sql",
    "/workspace/infra/tests/fixtures/canvas-agent-pgcrypto/verify.sql"
  )

  foreach ($sqlFile in $sqlFiles) {
    & docker exec $postgresName psql `
      --username postgres `
      --dbname pilo `
      --set ON_ERROR_STOP=1 `
      --file $sqlFile | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "SQL integration step failed: $sqlFile"
    }
  }

  Write-Host "Canvas Agent pgcrypto migration integration test passed."
}
finally {
  & docker rm --force $postgresName 2>$null | Out-Null
}
