param(
  [string]$Region = "ap-northeast-2",
  [string]$AwsCliPath = "aws",
  [string]$InstanceId = "",
  [string]$LiveKitDomain = "livekit.dev.pilo.my",
  [string]$TurnDomain = "turn.dev.pilo.my",
  [string]$AcmeEmail = "ejaj1217@gmail.com",
  [string]$RecordingsBucket = "pilo-dev-683655334891-uploads",
  [string]$RecordingsPrefix = "recordings/",
  [string]$DockerComposeVersion = "v2.29.7"
)

$ErrorActionPreference = "Stop"

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

function Get-LiveKitInstanceId {
  param([string]$AwsCli)

  $id = & $AwsCli ec2 describe-instances `
    --region $Region `
    --filters "Name=tag:Name,Values=pilo-dev-livekit" "Name=instance-state-name,Values=running" `
    --query "Reservations[0].Instances[0].InstanceId" `
    --output text

  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($id) -or $id -eq "None") {
    throw "Could not find a running EC2 instance tagged Name=pilo-dev-livekit."
  }

  return $id.Trim()
}

function Write-TempJson {
  param([object]$Value)

  $path = Join-Path ([IO.Path]::GetTempPath()) ("pilo-livekit-ssm-{0}.json" -f [guid]::NewGuid())
  $json = $Value | ConvertTo-Json -Depth 8
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($path, $json, $utf8NoBom)
  return $path
}

function Wait-Command {
  param(
    [string]$AwsCli,
    [string]$CommandId,
    [string]$TargetInstanceId
  )

  $pending = @("Pending", "InProgress", "Delayed")

  do {
    Start-Sleep -Seconds 5
    try {
      $status = & $AwsCli ssm get-command-invocation `
        --region $Region `
        --command-id $CommandId `
        --instance-id $TargetInstanceId `
        --query "Status" `
        --output text
    }
    catch {
      $status = "Pending"
    }
  } while ($pending -contains $status)

  $stdout = & $AwsCli ssm get-command-invocation `
    --region $Region `
    --command-id $CommandId `
    --instance-id $TargetInstanceId `
    --query "StandardOutputContent" `
    --output text

  $stderr = & $AwsCli ssm get-command-invocation `
    --region $Region `
    --command-id $CommandId `
    --instance-id $TargetInstanceId `
    --query "StandardErrorContent" `
    --output text

  if (-not [string]::IsNullOrWhiteSpace($stdout)) {
    Write-Output $stdout
  }

  if ($status -ne "Success") {
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      Write-Error ($stderr | Out-String)
    }
    throw "SSM command $CommandId finished with status $status."
  }
}

$AwsCli = Resolve-AwsCli $AwsCliPath

if ([string]::IsNullOrWhiteSpace($InstanceId)) {
  $InstanceId = Get-LiveKitInstanceId $AwsCli
}

$remoteScriptTemplate = @'
set -euxo pipefail

REGION="{{REGION}}"
LIVEKIT_DOMAIN="{{LIVEKIT_DOMAIN}}"
TURN_DOMAIN="{{TURN_DOMAIN}}"
ACME_EMAIL="{{ACME_EMAIL}}"
RECORDINGS_BUCKET="{{RECORDINGS_BUCKET}}"
RECORDINGS_PREFIX="{{RECORDINGS_PREFIX}}"
DOCKER_COMPOSE_VERSION="{{DOCKER_COMPOSE_VERSION}}"

if ! command -v docker >/dev/null 2>&1; then
  dnf install -y docker
fi

if ! docker compose version >/dev/null 2>&1; then
  if ! command -v curl >/dev/null 2>&1; then
    dnf install -y curl-minimal || dnf install -y curl --allowerasing
  fi
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fL --retry 3 "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

if ! command -v aws >/dev/null 2>&1; then
  dnf install -y awscli
fi

systemctl enable --now docker
mkdir -p /opt/pilo/livekit
cd /opt/pilo/livekit

get_secret() {
  aws secretsmanager get-secret-value \
    --region "$REGION" \
    --secret-id "$1" \
    --query SecretString \
    --output text
}

LIVEKIT_API_KEY="$(get_secret pilo-dev/app-server/LIVEKIT_API_KEY)"
LIVEKIT_API_SECRET="$(get_secret pilo-dev/app-server/LIVEKIT_API_SECRET)"
LIVEKIT_URL="$(get_secret pilo-dev/app-server/LIVEKIT_URL)"
LIVEKIT_WS_URL="$(get_secret pilo-dev/app-server/LIVEKIT_WS_URL)"
LIVEKIT_RECORDINGS_BUCKET="$(get_secret pilo-dev/app-server/LIVEKIT_RECORDINGS_BUCKET)"

cat >docker-compose.yml <<'COMPOSE'
services:
  redis:
    image: redis:7-alpine
    command: ["redis-server", "/usr/local/etc/redis/redis.conf"]
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
      - redis_data:/data

  livekit:
    image: livekit/livekit-server:latest
    command: ["--config", "/etc/livekit/livekit.yaml"]
    depends_on:
      - redis
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./livekit.yaml:/etc/livekit/livekit.yaml:ro

  egress:
    image: livekit/egress:latest
    cap_add:
      - SYS_ADMIN
    depends_on:
      - redis
      - livekit
    environment:
      EGRESS_CONFIG_FILE: /etc/livekit/egress.yaml
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./egress.yaml:/etc/livekit/egress.yaml:ro

  caddy:
    image: caddy:2-alpine
    depends_on:
      - livekit
    environment:
      ACME_EMAIL: ${ACME_EMAIL:-ejaj1217@gmail.com}
      LIVEKIT_DOMAIN: ${LIVEKIT_DOMAIN:-livekit.dev.pilo.my}
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  redis_data:
  caddy_data:
  caddy_config:
COMPOSE

cat >redis.conf <<'REDIS'
bind 127.0.0.1
protected-mode yes
appendonly yes
REDIS

cat >.env <<EOF
LIVEKIT_DOMAIN=$LIVEKIT_DOMAIN
LIVEKIT_TURN_DOMAIN=$TURN_DOMAIN
ACME_EMAIL=$ACME_EMAIL
AWS_REGION=$REGION
LIVEKIT_EGRESS_S3_BUCKET=$LIVEKIT_RECORDINGS_BUCKET
LIVEKIT_EGRESS_S3_PREFIX=$RECORDINGS_PREFIX
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
EOF

cat >livekit.yaml <<EOF
port: 7880
log_level: info

rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true

redis:
  address: 127.0.0.1:6379

keys:
  "$LIVEKIT_API_KEY": "$LIVEKIT_API_SECRET"

turn:
  enabled: true
  domain: "$TURN_DOMAIN"
  udp_port: 3478
EOF

cat >egress.yaml <<EOF
log_level: info
api_key: "$LIVEKIT_API_KEY"
api_secret: "$LIVEKIT_API_SECRET"
ws_url: ws://127.0.0.1:7880
insecure: true

redis:
  address: 127.0.0.1:6379

health_port: 7981

s3:
  region: "$REGION"
  bucket: "$LIVEKIT_RECORDINGS_BUCKET"
EOF

cat >Caddyfile <<EOF
{
  email $ACME_EMAIL
}

$LIVEKIT_DOMAIN {
  reverse_proxy 127.0.0.1:7880
}
EOF

chown -R ec2-user:ec2-user /opt/pilo/livekit
docker compose --env-file .env pull
docker compose --env-file .env up -d
docker compose --env-file .env ps
'@

$remoteScript = $remoteScriptTemplate.
  Replace("{{REGION}}", $Region).
  Replace("{{LIVEKIT_DOMAIN}}", $LiveKitDomain).
  Replace("{{TURN_DOMAIN}}", $TurnDomain).
  Replace("{{ACME_EMAIL}}", $AcmeEmail).
  Replace("{{RECORDINGS_BUCKET}}", $RecordingsBucket).
  Replace("{{RECORDINGS_PREFIX}}", $RecordingsPrefix).
  Replace("{{DOCKER_COMPOSE_VERSION}}", $DockerComposeVersion)

$payloadPath = Write-TempJson @{
  DocumentName    = "AWS-RunShellScript"
  InstanceIds     = @($InstanceId)
  Parameters      = @{ commands = @($remoteScript) }
  TimeoutSeconds  = 1800
  Comment         = "Deploy PILO LiveKit host"
}

try {
  $commandId = & $AwsCli ssm send-command `
    --region $Region `
    --cli-input-json "file://$payloadPath" `
    --query "Command.CommandId" `
    --output text
}
finally {
  Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
}

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commandId)) {
  throw "Failed to send SSM command."
}

Write-Output "sent SSM command $commandId to $InstanceId"
Wait-Command $AwsCli $commandId.Trim() $InstanceId
Write-Output "done"
