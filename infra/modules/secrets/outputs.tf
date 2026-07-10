output "secret_arns" {
  value = [for secret in aws_secretsmanager_secret.this : secret.arn]
}

output "app_server_ecs_secrets" {
  value = merge(
    {
      for name in local.app_server_ecs_secret_names :
      name => aws_secretsmanager_secret.this["app-server/${name}"].arn
    },
    {
      for name in local.shared_ecs_secret_names :
      name => aws_secretsmanager_secret.this["shared/${name}"].arn
    },
  )
}

output "realtime_server_ecs_secrets" {
  value = {
    for name in local.realtime_server_ecs_secret_names :
    name => aws_secretsmanager_secret.this["realtime-server/${name}"].arn
  }
}

output "ai_worker_ecs_secrets" {
  value = merge(
    {
      for name in local.ai_worker_ecs_secret_names :
      name => aws_secretsmanager_secret.this["ai-worker/${name}"].arn
    },
    {
      for name in local.shared_ecs_secret_names :
      name => aws_secretsmanager_secret.this["shared/${name}"].arn
    },
  )
}

output "livekit_host_secret_arns" {
  value = {
    for name in [
      "LIVEKIT_API_KEY",
      "LIVEKIT_API_SECRET",
      "LIVEKIT_URL",
      "LIVEKIT_WS_URL",
      "LIVEKIT_RECORDINGS_BUCKET",
    ] :
    name => aws_secretsmanager_secret.this["app-server/${name}"].arn
  }
}
