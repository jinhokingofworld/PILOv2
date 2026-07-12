param(
  [string]$Region = "ap-northeast-2",
  [string]$AwsCliPath = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
)

$ErrorActionPreference = "Stop"

function Read-OptionalSecureText {
  param([string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  if ($secure.Length -eq 0) {
    return ""
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Put-SecretIfPresent {
  param(
    [string]$Name,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    Write-Output "skip    $Name"
    return
  }

  $null = & $AwsCliPath secretsmanager put-secret-value `
    --region $Region `
    --secret-id $Name `
    --secret-string $Value

  Write-Output "updated $Name"
}

if (-not (Test-Path -LiteralPath $AwsCliPath)) {
  throw "AWS CLI not found at $AwsCliPath"
}

Write-Output "Blank input skips that secret."

$databaseUrl = Read-OptionalSecureText "DATABASE_URL"
$redisUrl = Read-OptionalSecureText "REDIS_URL"
$jwtSecret = Read-OptionalSecureText "JWT_SECRET"
$sessionSecret = Read-OptionalSecureText "SESSION_SECRET"
$googleOAuthClientId = Read-Host "GOOGLE_OAUTH_CLIENT_ID"
$googleOAuthClientSecret = Read-OptionalSecureText "GOOGLE_OAUTH_CLIENT_SECRET"
$githubLoginClientId = Read-Host "GITHUB_LOGIN_CLIENT_ID"
$githubLoginClientSecret = Read-OptionalSecureText "GITHUB_LOGIN_CLIENT_SECRET"
$githubUserOAuthClientId = Read-Host "GITHUB_USER_OAUTH_CLIENT_ID"
$githubUserOAuthClientSecret = Read-OptionalSecureText "GITHUB_USER_OAUTH_CLIENT_SECRET"
$openAiApiKey = Read-OptionalSecureText "OPENAI_API_KEY"
$githubAppId = Read-Host "GITHUB_APP_ID"
$githubAppSlug = Read-Host "GITHUB_APP_SLUG"
$githubPrivateKeyPath = Read-Host "GITHUB_APP_PRIVATE_KEY file path"
$githubWebhookSecret = Read-OptionalSecureText "GITHUB_WEBHOOK_SECRET"
$githubTokenEncryptionKey = Read-OptionalSecureText "GITHUB_TOKEN_ENCRYPTION_KEY"
$meetingReportEventToken = Read-OptionalSecureText "MEETING_REPORT_EVENT_TOKEN"
$livekitApiKey = Read-OptionalSecureText "LIVEKIT_API_KEY"
$livekitApiSecret = Read-OptionalSecureText "LIVEKIT_API_SECRET"
$livekitUrl = Read-Host "LIVEKIT_URL"
$livekitWsUrl = Read-Host "LIVEKIT_WS_URL"
$livekitRecordingsBucket = Read-Host "LIVEKIT_RECORDINGS_BUCKET"

$githubPrivateKey = ""
if (-not [string]::IsNullOrWhiteSpace($githubPrivateKeyPath)) {
  $resolvedPath = Resolve-Path -LiteralPath $githubPrivateKeyPath
  $githubPrivateKey = Get-Content -LiteralPath $resolvedPath -Raw
}

Put-SecretIfPresent "pilo-dev/app-server/DATABASE_URL" $databaseUrl
Put-SecretIfPresent "pilo-dev/realtime-server/DATABASE_URL" $databaseUrl
Put-SecretIfPresent "pilo-dev/ai-worker/DATABASE_URL" $databaseUrl

Put-SecretIfPresent "pilo-dev/app-server/REDIS_URL" $redisUrl
Put-SecretIfPresent "pilo-dev/realtime-server/REDIS_URL" $redisUrl
Put-SecretIfPresent "pilo-dev/ai-worker/REDIS_URL" $redisUrl

Put-SecretIfPresent "pilo-dev/app-server/JWT_SECRET" $jwtSecret
Put-SecretIfPresent "pilo-dev/realtime-server/JWT_SECRET" $jwtSecret
Put-SecretIfPresent "pilo-dev/app-server/SESSION_SECRET" $sessionSecret

Put-SecretIfPresent "pilo-dev/app-server/GOOGLE_OAUTH_CLIENT_ID" $googleOAuthClientId
Put-SecretIfPresent "pilo-dev/app-server/GOOGLE_OAUTH_CLIENT_SECRET" $googleOAuthClientSecret
Put-SecretIfPresent "pilo-dev/app-server/GITHUB_LOGIN_CLIENT_ID" $githubLoginClientId
Put-SecretIfPresent "pilo-dev/app-server/GITHUB_LOGIN_CLIENT_SECRET" $githubLoginClientSecret
Put-SecretIfPresent "pilo-dev/app-server/GITHUB_USER_OAUTH_CLIENT_ID" $githubUserOAuthClientId
Put-SecretIfPresent "pilo-dev/app-server/GITHUB_USER_OAUTH_CLIENT_SECRET" $githubUserOAuthClientSecret

Put-SecretIfPresent "pilo-dev/app-server/OPENAI_API_KEY" $openAiApiKey
Put-SecretIfPresent "pilo-dev/ai-worker/OPENAI_API_KEY" $openAiApiKey

Put-SecretIfPresent "pilo-dev/app-server/GITHUB_APP_ID" $githubAppId
Put-SecretIfPresent "pilo-dev/ai-worker/GITHUB_APP_ID" $githubAppId
Put-SecretIfPresent "pilo-dev/app-server/GITHUB_APP_SLUG" $githubAppSlug
Put-SecretIfPresent "pilo-dev/app-server/GITHUB_APP_PRIVATE_KEY" $githubPrivateKey
Put-SecretIfPresent "pilo-dev/ai-worker/GITHUB_APP_PRIVATE_KEY" $githubPrivateKey
Put-SecretIfPresent "pilo-dev/app-server/GITHUB_WEBHOOK_SECRET" $githubWebhookSecret
Put-SecretIfPresent "pilo-dev/app-server/GITHUB_TOKEN_ENCRYPTION_KEY" $githubTokenEncryptionKey
Put-SecretIfPresent "pilo-dev/shared/MEETING_REPORT_EVENT_TOKEN" $meetingReportEventToken

Put-SecretIfPresent "pilo-dev/app-server/LIVEKIT_API_KEY" $livekitApiKey
Put-SecretIfPresent "pilo-dev/app-server/LIVEKIT_API_SECRET" $livekitApiSecret
Put-SecretIfPresent "pilo-dev/app-server/LIVEKIT_URL" $livekitUrl
Put-SecretIfPresent "pilo-dev/app-server/LIVEKIT_WS_URL" $livekitWsUrl
Put-SecretIfPresent "pilo-dev/app-server/LIVEKIT_RECORDINGS_BUCKET" $livekitRecordingsBucket

Write-Output "done"
