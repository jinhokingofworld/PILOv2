param(
  [ValidateSet("apply", "baseline")]
  [string] $Mode = "apply",
  [string] $BaselineThrough = "",
  [string] $ConfirmBaseline = "",
  [string] $ImageTag = "",
  [string] $AwsProfile = "pilo-dev",
  [string] $AwsRegion = "ap-northeast-2",
  [string] $ClusterName = "pilo-dev-cluster",
  [string] $NetworkSourceService = "pilo-dev-app-server",
  [string] $TaskDefinition = "pilo-dev-db-migrations",
  [string] $RepositoryName = "pilo-db-migrations"
)

$ErrorActionPreference = "Stop"

function Invoke-AwsJson {
  param([string[]] $Arguments)

  $output = & $awsCommand @Arguments --output json
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed: aws $($Arguments -join ' ')"
  }

  return $output | ConvertFrom-Json
}

function Get-RepositoryUri {
  param([string] $Image)

  if ($Image -match "@") {
    return ($Image -split "@", 2)[0]
  }

  $tagSeparator = $Image.LastIndexOf(":")
  if ($tagSeparator -lt 0) {
    throw "Migration task definition image must include a tag or digest."
  }

  return $Image.Substring(0, $tagSeparator)
}

$awsCommand = (Get-Command aws -ErrorAction SilentlyContinue).Source
if (-not $awsCommand) {
  $awsFallback = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
  if (Test-Path $awsFallback) {
    $awsCommand = $awsFallback
  } else {
    throw "AWS CLI was not found."
  }
}

if (-not $ImageTag) {
  throw "ImageTag is required. Use the full dev merge commit SHA published by the DB migration runner workflow."
}

if ($ImageTag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') {
  throw "ImageTag contains unsupported characters."
}

if ($Mode -eq "baseline") {
  if ($BaselineThrough -notmatch '^\d{3}$') {
    throw "BaselineThrough must be a three-digit migration version."
  }
  if ($ConfirmBaseline -ne "RDS_SCHEMA_VERIFIED") {
    throw "Baseline mode requires -ConfirmBaseline RDS_SCHEMA_VERIFIED."
  }
}

$service = Invoke-AwsJson @(
  "ecs", "describe-services",
  "--profile", $AwsProfile,
  "--region", $AwsRegion,
  "--cluster", $ClusterName,
  "--services", $NetworkSourceService
)

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

$image = Invoke-AwsJson @(
  "ecr", "describe-images",
  "--profile", $AwsProfile,
  "--region", $AwsRegion,
  "--repository-name", $RepositoryName,
  "--image-ids", "imageTag=$ImageTag"
)
$imageDigest = $image.imageDetails[0].imageDigest
if (-not $imageDigest) {
  throw "Could not resolve an ECR image digest for $RepositoryName`:$ImageTag."
}

$definitionResult = Invoke-AwsJson @(
  "ecs", "describe-task-definition",
  "--profile", $AwsProfile,
  "--region", $AwsRegion,
  "--task-definition", $TaskDefinition
)
$definition = $definitionResult.taskDefinition
$migrationContainer = $definition.containerDefinitions |
  Where-Object { $_.name -eq "db-migrations" } |
  Select-Object -First 1

if (-not $migrationContainer) {
  throw "Could not find the db-migrations container in $TaskDefinition."
}

$repositoryUri = Get-RepositoryUri $migrationContainer.image
$imageReference = "$repositoryUri@$imageDigest"
$migrationContainer.image = $imageReference

$containerDefinitionsFile = [System.IO.Path]::GetTempFileName()
$networkFile = [System.IO.Path]::GetTempFileName()
$overridesFile = [System.IO.Path]::GetTempFileName()
$volumesFile = $null
$placementConstraintsFile = $null

try {
  $definition.containerDefinitions | ConvertTo-Json -Depth 32 -Compress |
    Set-Content -LiteralPath $containerDefinitionsFile -Encoding ascii

  $registerArguments = @(
    "ecs", "register-task-definition",
    "--profile", $AwsProfile,
    "--region", $AwsRegion,
    "--family", $definition.family,
    "--network-mode", $definition.networkMode,
    "--container-definitions", "file://$containerDefinitionsFile",
    "--cpu", $definition.cpu,
    "--memory", $definition.memory
  )

  if ($definition.executionRoleArn) {
    $registerArguments += @("--execution-role-arn", $definition.executionRoleArn)
  }
  if ($definition.taskRoleArn) {
    $registerArguments += @("--task-role-arn", $definition.taskRoleArn)
  }
  if ($definition.requiresCompatibilities) {
    $registerArguments += "--requires-compatibilities"
    $registerArguments += @($definition.requiresCompatibilities)
  }
  if ($definition.runtimePlatform) {
    $runtimePlatform = @()
    if ($definition.runtimePlatform.cpuArchitecture) {
      $runtimePlatform += "cpuArchitecture=$($definition.runtimePlatform.cpuArchitecture)"
    }
    if ($definition.runtimePlatform.operatingSystemFamily) {
      $runtimePlatform += "operatingSystemFamily=$($definition.runtimePlatform.operatingSystemFamily)"
    }
    if ($runtimePlatform.Count -gt 0) {
      $registerArguments += @("--runtime-platform", ($runtimePlatform -join ","))
    }
  }
  if ($definition.volumes -and $definition.volumes.Count -gt 0) {
    $volumesFile = [System.IO.Path]::GetTempFileName()
    $definition.volumes | ConvertTo-Json -Depth 32 -Compress |
      Set-Content -LiteralPath $volumesFile -Encoding ascii
    $registerArguments += @("--volumes", "file://$volumesFile")
  }
  if ($definition.placementConstraints -and $definition.placementConstraints.Count -gt 0) {
    $placementConstraintsFile = [System.IO.Path]::GetTempFileName()
    $definition.placementConstraints | ConvertTo-Json -Depth 32 -Compress |
      Set-Content -LiteralPath $placementConstraintsFile -Encoding ascii
    $registerArguments += @("--placement-constraints", "file://$placementConstraintsFile")
  }

  $registeredDefinition = Invoke-AwsJson $registerArguments
  $registeredTaskDefinitionArn = $registeredDefinition.taskDefinition.taskDefinitionArn
  if (-not $registeredTaskDefinitionArn) {
    throw "Could not register an immutable DB migration task definition."
  }

  $environment = @(
    @{ name = "MIGRATION_MODE"; value = $Mode },
    @{ name = "MIGRATION_SOURCE_REVISION"; value = $ImageTag }
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

  $networkConfiguration | ConvertTo-Json -Depth 8 -Compress |
    Set-Content -LiteralPath $networkFile -Encoding ascii
  $overrides | ConvertTo-Json -Depth 8 -Compress |
    Set-Content -LiteralPath $overridesFile -Encoding ascii

  $taskArn = (& $awsCommand ecs run-task `
    --profile $AwsProfile `
    --region $AwsRegion `
    --cluster $ClusterName `
    --launch-type FARGATE `
    --task-definition $registeredTaskDefinitionArn `
    --network-configuration "file://$networkFile" `
    --overrides "file://$overridesFile" `
    --query "tasks[0].taskArn" `
    --output text).Trim()

  if (-not $taskArn -or $taskArn -eq "None") {
    throw "DB migration ECS task did not start."
  }

  Write-Host "Using immutable image $imageReference"
  Write-Host "Registered $registeredTaskDefinitionArn"
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
  Write-Host "CloudWatch log stream: /ecs/pilo-dev/db-migrations / $logStreamName"

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
  $temporaryFiles = @(
    $containerDefinitionsFile,
    $networkFile,
    $overridesFile,
    $volumesFile,
    $placementConstraintsFile
  ) | Where-Object { $_ }

  if ($temporaryFiles.Count -gt 0) {
    Remove-Item -LiteralPath $temporaryFiles -Force -ErrorAction SilentlyContinue
  }
}
