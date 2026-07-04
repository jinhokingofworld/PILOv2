param(
  [string]$Region = "ap-northeast-2",
  [string]$AwsCliPath = "aws",
  [string]$LiveKitDomain = "livekit.dev.pilo.my",
  [string]$TurnDomain = "turn.dev.pilo.my",
  [string]$AcmeEmail = "ejaj1217@gmail.com",
  [string]$RecordingsBucket = "pilo-dev-683655334891-uploads",
  [string]$RecordingsPrefix = "recordings/",
  [string]$ApiKey = "pilo_dev_key",
  [string]$ApiSecret = "",
  [switch]$NonInteractive,
  [switch]$UpdateAwsSecrets,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$LiveKitDir = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\livekit")

function Read-Value {
  param(
    [string]$Prompt,
    [string]$Default
  )

  $suffix = ""
  if (-not [string]::IsNullOrWhiteSpace($Default)) {
    $suffix = " [$Default]"
  }

  $value = Read-Host "$Prompt$suffix"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }

  return $value.Trim()
}

function Convert-SecureStringToPlain {
  param([securestring]$SecureValue)

  if ($SecureValue.Length -eq 0) {
    return ""
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function New-RandomSecret {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  }
  finally {
    $rng.Dispose()
  }

  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Read-SecretOrGenerate {
  param([string]$Prompt)

  $secureValue = Read-Host "$Prompt (blank = generate)" -AsSecureString
  $plainValue = Convert-SecureStringToPlain $secureValue
  if ([string]::IsNullOrWhiteSpace($plainValue)) {
    return New-RandomSecret
  }

  return $plainValue.Trim()
}

function Assert-SingleLineValue {
  param(
    [string]$Name,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Name cannot be blank."
  }

  if ($Value -match "[`r`n]") {
    throw "$Name must be a single-line value."
  }
}

function Format-YamlScalar {
  param([string]$Value)

  return "'" + $Value.Replace("'", "''") + "'"
}

function Write-GeneratedFile {
  param(
    [string]$Path,
    [string[]]$Lines
  )

  if ((Test-Path -LiteralPath $Path) -and -not $Force) {
    $answer = Read-Host "Overwrite $Path? [y/N]"
    if ($answer -ne "y" -and $answer -ne "Y") {
      throw "Skipped $Path. Re-run with -Force to overwrite without a prompt."
    }
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, (($Lines -join "`r`n") + "`r`n"), $utf8NoBom)
  Write-Output "wrote   $Path"
}

function Resolve-AwsCli {
  param([string]$PathOrCommand)

  if (Test-Path -LiteralPath $PathOrCommand) {
    return (Resolve-Path -LiteralPath $PathOrCommand).Path
  }

  $command = Get-Command $PathOrCommand -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  throw "AWS CLI not found. Pass -AwsCliPath or install aws in PATH."
}

function Put-SecretValue {
  param(
    [string]$AwsCli,
    [string]$Name,
    [string]$Value
  )

  $null = & $AwsCli secretsmanager put-secret-value `
    --region $Region `
    --secret-id $Name `
    --secret-string $Value

  Write-Output "updated $Name"
}

Write-Output "Configure LiveKit host files under $LiveKitDir"
Write-Output "Blank LIVEKIT_API_SECRET generates a strong random value."

if ($NonInteractive) {
  $liveKitDomain = $LiveKitDomain.Trim()
  $turnDomain = $TurnDomain.Trim()
  $acmeEmail = $AcmeEmail.Trim()
  $recordingsBucket = $RecordingsBucket.Trim()
  $recordingsPrefix = $RecordingsPrefix.Trim()
  $apiKey = $ApiKey.Trim()
  $apiSecret = $ApiSecret.Trim()

  if ([string]::IsNullOrWhiteSpace($acmeEmail)) {
    throw "AcmeEmail is required in -NonInteractive mode."
  }

  if ([string]::IsNullOrWhiteSpace($apiSecret)) {
    $apiSecret = New-RandomSecret
  }
}
else {
  $defaultAcmeEmail = $AcmeEmail
  $liveKitDomain = Read-Value "LIVEKIT_DOMAIN" $LiveKitDomain
  $turnDomain = Read-Value "LIVEKIT_TURN_DOMAIN" $TurnDomain
  $acmeEmail = Read-Value "ACME_EMAIL" $AcmeEmail
  $recordingsBucket = Read-Value "LIVEKIT_RECORDINGS_BUCKET" $RecordingsBucket
  $recordingsPrefix = Read-Value "LIVEKIT_EGRESS_S3_PREFIX" $RecordingsPrefix
  $apiKey = Read-Value "LIVEKIT_API_KEY" $ApiKey

  if ([string]::IsNullOrWhiteSpace($ApiSecret)) {
    $apiSecret = Read-SecretOrGenerate "LIVEKIT_API_SECRET"
  }
  else {
    $apiSecret = $ApiSecret.Trim()
  }
}

$liveKitUrl = "wss://$liveKitDomain"

$values = @{
  LIVEKIT_DOMAIN             = $liveKitDomain
  LIVEKIT_TURN_DOMAIN        = $turnDomain
  ACME_EMAIL                 = $acmeEmail
  LIVEKIT_RECORDINGS_BUCKET  = $recordingsBucket
  LIVEKIT_EGRESS_S3_PREFIX   = $recordingsPrefix
  LIVEKIT_API_KEY            = $apiKey
  LIVEKIT_API_SECRET         = $apiSecret
}

foreach ($name in $values.Keys) {
  Assert-SingleLineValue $name $values[$name]
}

$envPath = Join-Path $LiveKitDir ".env"
$livekitConfigPath = Join-Path $LiveKitDir "livekit.yaml"
$egressConfigPath = Join-Path $LiveKitDir "egress.yaml"
$caddyfilePath = Join-Path $LiveKitDir "Caddyfile"

Write-GeneratedFile $envPath @(
  "# Generated by infra/scripts/configure-dev-livekit.ps1.",
  "# Do not commit this file.",
  "",
  "LIVEKIT_DOMAIN=$liveKitDomain",
  "LIVEKIT_TURN_DOMAIN=$turnDomain",
  "ACME_EMAIL=$acmeEmail",
  "",
  "AWS_REGION=$Region",
  "LIVEKIT_EGRESS_S3_BUCKET=$recordingsBucket",
  "LIVEKIT_EGRESS_S3_PREFIX=$recordingsPrefix",
  "",
  "LIVEKIT_API_KEY=$apiKey",
  "LIVEKIT_API_SECRET=$apiSecret"
)

Write-GeneratedFile $livekitConfigPath @(
  "# Generated by infra/scripts/configure-dev-livekit.ps1.",
  "# Do not commit this file.",
  "",
  "port: 7880",
  "log_level: info",
  "",
  "rtc:",
  "  tcp_port: 7881",
  "  port_range_start: 50000",
  "  port_range_end: 60000",
  "  use_external_ip: true",
  "",
  "redis:",
  "  address: 127.0.0.1:6379",
  "",
  "keys:",
  "  $(Format-YamlScalar $apiKey): $(Format-YamlScalar $apiSecret)",
  "",
  "turn:",
  "  enabled: true",
  "  domain: $(Format-YamlScalar $turnDomain)",
  "  udp_port: 3478"
)

Write-GeneratedFile $egressConfigPath @(
  "# Generated by infra/scripts/configure-dev-livekit.ps1.",
  "# Do not commit this file.",
  "",
  "log_level: info",
  "api_key: $(Format-YamlScalar $apiKey)",
  "api_secret: $(Format-YamlScalar $apiSecret)",
  "ws_url: ws://127.0.0.1:7880",
  "insecure: true",
  "",
  "redis:",
  "  address: 127.0.0.1:6379",
  "",
  "health_port: 7981",
  "",
  "s3:",
  "  region: $(Format-YamlScalar $Region)",
  "  bucket: $(Format-YamlScalar $recordingsBucket)"
)

Write-GeneratedFile $caddyfilePath @(
  "{",
  "  email $acmeEmail",
  "}",
  "",
  "$liveKitDomain {",
  "  reverse_proxy 127.0.0.1:7880",
  "}"
)

if ($UpdateAwsSecrets) {
  $resolvedAwsCli = Resolve-AwsCli $AwsCliPath

  Put-SecretValue $resolvedAwsCli "pilo-dev/app-server/LIVEKIT_API_KEY" $apiKey
  Put-SecretValue $resolvedAwsCli "pilo-dev/app-server/LIVEKIT_API_SECRET" $apiSecret
  Put-SecretValue $resolvedAwsCli "pilo-dev/app-server/LIVEKIT_URL" $liveKitUrl
  Put-SecretValue $resolvedAwsCli "pilo-dev/app-server/LIVEKIT_WS_URL" $liveKitUrl
  Put-SecretValue $resolvedAwsCli "pilo-dev/app-server/LIVEKIT_RECORDINGS_BUCKET" $recordingsBucket
}
else {
  Write-Output "skipped AWS Secrets Manager update. Re-run with -UpdateAwsSecrets after approval."
}

Write-Output "done"
