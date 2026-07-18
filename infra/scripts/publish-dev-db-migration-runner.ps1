param(
  [string] $AwsProfile = "pilo-dev",
  [string] $AwsRegion = "ap-northeast-2",
  [string] $RepositoryName = "pilo-db-migrations",
  [string] $SourceRevision = ""
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$dockerfile = Join-Path $repoRoot "infra\db-migrations\Dockerfile"
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
  $dirtyImageSources = git -C $repoRoot status --porcelain -- `
    db/migrations `
    infra/db-migrations
  if ($dirtyImageSources) {
    throw "Commit db/migrations and infra/db-migrations before publishing the runner image."
  }
  $SourceRevision = (git -C $repoRoot rev-parse --short=12 HEAD).Trim()
}

if ($SourceRevision -notmatch '^[A-Za-z0-9._-]+$') {
  throw "SourceRevision contains unsupported characters."
}

$accountId = (& $awsCommand sts get-caller-identity `
  --profile $AwsProfile `
  --query Account `
  --output text).Trim()

$registry = "$accountId.dkr.ecr.$AwsRegion.amazonaws.com"
$repositoryUri = "$registry/$RepositoryName"

& $awsCommand ecr describe-repositories `
  --profile $AwsProfile `
  --region $AwsRegion `
  --repository-names $RepositoryName | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "ECR repository not found. Apply the dev Terraform change first."
}

$password = & $awsCommand ecr get-login-password `
  --profile $AwsProfile `
  --region $AwsRegion
$password | docker login --username AWS --password-stdin $registry | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "ECR login failed."
}

& docker build `
  --file $dockerfile `
  --build-arg "SOURCE_REVISION=$SourceRevision" `
  --tag "${repositoryUri}:${SourceRevision}" `
  --tag "${repositoryUri}:latest" `
  $repoRoot
if ($LASTEXITCODE -ne 0) {
  throw "DB migration runner image build failed."
}

& docker push "${repositoryUri}:${SourceRevision}" | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Versioned DB migration runner image push failed."
}

& docker push "${repositoryUri}:latest" | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Latest DB migration runner image push failed."
}

Write-Host "Published ${repositoryUri}:${SourceRevision}"
