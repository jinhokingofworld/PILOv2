# LiveKit Host Config

This directory contains the MVP self-hosted LiveKit template for a single EC2 host.
It does not create AWS resources by itself.

## Scope

The MVP LiveKit host runs these containers on one EC2 instance:

- LiveKit Server for WebRTC audio rooms
- Redis for LiveKit Server and Egress coordination
- LiveKit Egress for audio-only recordings
- Caddy for HTTPS termination in front of LiveKit's API/WebSocket port

`apps/realtime-server` remains the PILO app-level realtime service. It is not the
LiveKit media server.

## Files

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Runs LiveKit Server, Redis, Egress, and Caddy on the host network. |
| `.env.example` | Non-secret shape of host environment values. Copy to `.env` on the host. |
| `livekit.yaml.example` | LiveKit Server config template. Copy to `livekit.yaml` on the host. |
| `egress.yaml.example` | LiveKit Egress config template. Copy to `egress.yaml` on the host. |
| `Caddyfile.example` | Caddy HTTPS reverse proxy template. Copy to `Caddyfile` on the host. |
| `redis.conf` | Local Redis config bound to `127.0.0.1`. |

The real `.env`, `livekit.yaml`, `egress.yaml`, and `Caddyfile` files are ignored
because they can contain deployment-specific values and secrets.

The dev ACME contact email is `ejaj1217@gmail.com`.

## Network

Point both LiveKit DNS names to the EC2 public IP:

- `livekit.dev.pilo.my`
- `turn.dev.pilo.my`

Open these inbound rules on the LiveKit host security group:

| Port | Protocol | Purpose |
| --- | --- | --- |
| `80` | TCP | Caddy ACME HTTP challenge |
| `443` | TCP | LiveKit API/WebSocket via Caddy |
| `7881` | TCP | WebRTC TCP fallback |
| `3478` | UDP | Embedded TURN/STUN over UDP |
| `50000-60000` | UDP | WebRTC media ports |

Do not expose Redis `6379/tcp` or LiveKit `7880/tcp` publicly. Caddy proxies
public HTTPS traffic to `127.0.0.1:7880`.

## Recording Storage

Egress is configured to upload recordings to S3. In AWS, prefer an EC2 instance
profile with write permission to the recordings bucket or prefix. Only use
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` on the host if an instance
profile is not available.

The bucket is configured in `egress.yaml`. The object key/prefix should be set by
the App Server when it starts audio-only Egress, for example:

```text
recordings/meetings/{meetingId}.ogg
```

## App Integration

App Server should receive these values through AWS Secrets Manager or deployment
environment:

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL`, for example `wss://livekit.dev.pilo.my`
- `LIVEKIT_WS_URL`, for example `wss://livekit.dev.pilo.my`
- `LIVEKIT_RECORDINGS_BUCKET`
- `LIVEKIT_RECORDING_MODE=room_audio_only`

AI Worker should receive the recordings bucket or prefix used by App Server when
creating STT jobs.

## Host Startup

Generate the real host-only files with the helper script:

```powershell
.\infra\scripts\configure-dev-livekit.ps1
```

If Windows blocks `.ps1` execution policy, use the checked-in command wrapper:

```powershell
.\infra\scripts\configure-dev-livekit.cmd
```

To also update the App Server LiveKit values in AWS Secrets Manager, run it only
after approval:

```powershell
.\infra\scripts\configure-dev-livekit.ps1 -UpdateAwsSecrets
```

or, with the execution-policy wrapper:

```powershell
.\infra\scripts\configure-dev-livekit.cmd -UpdateAwsSecrets
```

Deploy the host files and start Docker Compose on the EC2 instance through SSM:

```powershell
.\infra\scripts\deploy-dev-livekit.cmd
```

After real host-only files are created on the EC2 instance:

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

Use a systemd unit or cloud-init later if the EC2 host should manage Docker
Compose automatically. Add Terraform EC2, security group, IAM instance profile,
and DNS resources only after approval.
