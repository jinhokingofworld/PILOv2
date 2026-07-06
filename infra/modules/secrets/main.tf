locals {
  app_server_ecs_secret_names = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "SESSION_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GITHUB_LOGIN_CLIENT_ID",
    "GITHUB_LOGIN_CLIENT_SECRET",
    "GITHUB_USER_OAUTH_CLIENT_ID",
    "GITHUB_USER_OAUTH_CLIENT_SECRET",
    "GITHUB_TOKEN_ENCRYPTION_KEY",
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "LIVEKIT_URL",
    "OPENAI_API_KEY",
  ]

  app_server_managed_secret_names = distinct(concat(local.app_server_ecs_secret_names, [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GITHUB_LOGIN_CLIENT_ID",
    "GITHUB_LOGIN_CLIENT_SECRET",
    "GITHUB_USER_OAUTH_CLIENT_ID",
    "GITHUB_USER_OAUTH_CLIENT_SECRET",
    "GITHUB_TOKEN_ENCRYPTION_KEY",
    "LIVEKIT_WS_URL",
    "LIVEKIT_RECORDINGS_BUCKET",
  ]))

  realtime_server_ecs_secret_names = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
  ]

  ai_worker_ecs_secret_names = [
    "DATABASE_URL",
    "REDIS_URL",
    "OPENAI_API_KEY",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
  ]

  all_secret_names = toset(concat(
    [for name in local.app_server_managed_secret_names : "app-server/${name}"],
    [for name in local.realtime_server_ecs_secret_names : "realtime-server/${name}"],
    [for name in local.ai_worker_ecs_secret_names : "ai-worker/${name}"],
  ))
}

resource "aws_secretsmanager_secret" "this" {
  for_each = local.all_secret_names

  name                    = "${var.name_prefix}/${each.key}"
  recovery_window_in_days = 7
}
