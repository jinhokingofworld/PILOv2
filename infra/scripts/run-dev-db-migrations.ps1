param(
  [ValidateSet("apply", "baseline")]
  [string] $Mode = "apply",
  [string] $BaselineThrough = "",
  [string] $ConfirmBaseline = "",
  [string] $SourceRevision = "",
  [string] $AwsProfile = "pilo-dev",
  [string] $AwsRegion = "ap-northeast-2",
  [string] $ClusterName = "pilo-dev-cluster",
  [string] $NetworkSourceService = "pilo-dev-app-server",
  [string] $TaskDefinition = "pilo-dev-db-migrations"
)

$ErrorActionPreference = "Stop"

$awsCommand = (Get-Command aws -ErrorAction SilentlyContinue).Source
if (-not $awsCommand) {
  $awsFallback = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
  if (Test-Path $awsFallback) {
    $awsCommand = $awsFallback
  } else {
    throw "AWS CLI was not found."
  }
}

if (-not $SourceRevision) {
  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
  $SourceRevision = (git -C $repoRoot rev-parse --short=12 HEAD).Trim()
}

if ($SourceRevision -notmatch '^[A-Za-z0-9._-]+$') {
  throw "SourceRevision contains unsupported characters."
}

if ($Mode -eq "baseline") {
  if ($BaselineThrough -notmatch '^\d{3}$') {
    throw "BaselineThrough must be a three-digit migration version."
  }
  if ($ConfirmBaseline -ne "RDS_SCHEMA_VERIFIED") {
    throw "Baseline mode requires -ConfirmBaseline RDS_SCHEMA_VERIFIED."
  }
}

$service = & $awsCommand ecs describe-services `
  --profile $AwsProfile `
  --region $AwsRegion `
  --cluster $ClusterName `
  --services $NetworkSourceService `
  --output json | ConvertFrom-Json

if (-not $service.services -or $service.services.Count -ne 1) {
  throw "Could not resolve the ECS service network configuration."
}

$network = $service.services[0].networkConfiguration.awsvpcConfiguration
$networkConfiguration = @{
  awsvpcConfiguration = @{
    subnets        = @($network.subnets)
    securityGroups = @($network.securityGroups)
    assignPublicIp = $network.assignPublicIp
  }
}

$environment = @(
  @{ name = "MIGRATION_MODE"; value = $Mode },
  @{ name = "MIGRATION_SOURCE_REVISION"; value = $SourceRevision }
)

if ($Mode -eq "baseline") {
  $environment += @(
    @{ name = "BASELINE_THROUGH"; value = $BaselineThrough },
    @{ name = "CONFIRM_BASELINE"; value = $ConfirmBaseline }
  )
}

$overrides = @{
  containerOverrides = @(
    @{
      name        = "db-migrations"
      environment = $environment
    }
  )
}

$networkFile = [System.IO.Path]::GetTempFileName()
$overridesFile = [System.IO.Path]::GetTempFileName()

try {
  $networkConfiguration | ConvertTo-Json -Depth 8 -Compress |
    Set-Content -LiteralPath $networkFile -Encoding ascii
  $overrides | ConvertTo-Json -Depth 8 -Compress |
    Set-Content -LiteralPath $overridesFile -Encoding ascii

  $taskArn = (& $awsCommand ecs run-task `
    --profile $AwsProfile `
    --region $AwsRegion `
    --cluster $ClusterName `
    --launch-type FARGATE `
    --task-definition $TaskDefinition `
    --network-configuration "file://$networkFile" `
    --overrides "file://$overridesFile" `
    --query "tasks[0].taskArn" `
    --output text).Trim()

  if (-not $taskArn -or $taskArn -eq "None") {
    throw "DB migration ECS task did not start."
  }

  Write-Host "Started $taskArn"

  & $awsCommand ecs wait tasks-stopped `
    --profile $AwsProfile `
    --region $AwsRegion `
    --cluster $ClusterName `
    --tasks $taskArn

  $task = & $awsCommand ecs describe-tasks `
    --profile $AwsProfile `
    --region $AwsRegion `
    --cluster $ClusterName `
    --tasks $taskArn `
    --output json | ConvertFrom-Json

  $container = $task.tasks[0].containers |
    Where-Object { $_.name -eq "db-migrations" } |
    Select-Object -First 1

  $taskId = ($taskArn -split '/')[-1]
  $logStreamName = "runner/db-migrations/$taskId"

  if ($taskId) {
    & $awsCommand logs get-log-events `
      --profile $AwsProfile `
      --region $AwsRegion `
      --log-group-name "/ecs/pilo-dev/db-migrations" `
      --log-stream-name $logStreamName `
      --start-from-head `
      --query "events[].message" `
      --output text | Out-Host
  }

  if ($container.exitCode -ne 0) {
    throw "DB migration task failed with exit code $($container.exitCode): $($container.reason)"
  }

  Write-Host "DB migration task completed successfully."
}
finally {
  Remove-Item -LiteralPath $networkFile, $overridesFile -Force -ErrorAction SilentlyContinue
}
