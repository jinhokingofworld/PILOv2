locals {
  name_prefix = "${var.project_name}-${var.environment}"

  agent_router_timeout_ms                = 45000
  agent_planner_timeout_ms               = 60000
  canvas_html_timeout_ms                 = 180000
  agent_handoff_timeout_seconds          = 10
  agent_sqs_visibility_timeout_seconds   = 180
  agent_sqs_visibility_heartbeat_seconds = 45
  agent_planning_timeout_seconds         = 240
  agent_execution_lease_seconds          = 180
  agent_execution_heartbeat_seconds      = 30
  agent_grounded_answer_timeout_seconds  = 300

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  frontend_domain = var.create_dns_records ? var.frontend_domain_name : ""
  api_domain      = var.create_dns_records ? var.api_domain_name : ""
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

module "terraform_state" {
  source = "../../modules/terraform-state"

  name_prefix = local.name_prefix
  account_id  = data.aws_caller_identity.current.account_id
}

module "network" {
  source = "../../modules/network"

  name_prefix          = local.name_prefix
  vpc_cidr             = var.vpc_cidr
  availability_zones   = slice(data.aws_availability_zones.available.names, 0, 2)
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  enable_nat_gateway   = var.enable_nat_gateway
}

module "security_groups" {
  source = "../../modules/security-groups"

  name_prefix          = local.name_prefix
  vpc_id               = module.network.vpc_id
  app_server_port      = var.app_server_port
  realtime_server_port = var.realtime_server_port
}

module "s3" {
  source = "../../modules/s3"

  name_prefix = local.name_prefix
  uploads_cors_allowed_origins = compact([
    "http://localhost:3000",
    local.frontend_domain == "" ? "" : "https://${local.frontend_domain}",
  ])
}

module "livekit_host" {
  source = "../../modules/livekit-host"

  name_prefix           = local.name_prefix
  vpc_id                = module.network.vpc_id
  subnet_id             = module.network.public_subnet_ids[0]
  recordings_bucket_arn = module.s3.uploads_bucket_arn
  livekit_secret_arns   = values(module.secrets.livekit_host_secret_arns)
  ami_id                = var.livekit_ami_id
  instance_type         = var.livekit_instance_type
  root_volume_size      = var.livekit_root_volume_size
  allowed_cidr_blocks   = var.livekit_allowed_cidr_blocks
}

module "route53_acm" {
  source = "../../modules/route53-acm"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  create_dns_records   = var.create_dns_records
  hosted_zone_id       = var.hosted_zone_id
  frontend_domain_name = var.frontend_domain_name
  api_domain_name      = var.api_domain_name
}

module "cloudfront" {
  source = "../../modules/cloudfront"

  name_prefix                 = local.name_prefix
  frontend_bucket_name        = module.s3.frontend_bucket_name
  frontend_bucket_arn         = module.s3.frontend_bucket_arn
  frontend_bucket_domain_name = module.s3.frontend_bucket_regional_domain_name
  aliases                     = local.frontend_domain == "" ? [] : [local.frontend_domain]
  acm_certificate_arn         = module.route53_acm.cloudfront_certificate_arn
}

module "ecr" {
  source = "../../modules/ecr"

  name_prefix = local.name_prefix
  repositories = [
    "pilo-app-server",
    "pilo-realtime-server",
    "pilo-ai-worker",
    "pilo-db-migrations",
  ]
}

module "sqs" {
  source = "../../modules/sqs"

  name_prefix                      = local.name_prefix
  agent_visibility_timeout_seconds = local.agent_sqs_visibility_timeout_seconds
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix = local.name_prefix
}

module "iam" {
  source = "../../modules/iam"

  name_prefix         = local.name_prefix
  aws_region          = var.aws_region
  github_owner        = var.github_owner
  github_repo         = var.github_repo
  ecr_repository_arns = module.ecr.repository_arns
  db_migration_publisher_repository_arn = one([
    for arn in module.ecr.repository_arns : arn
    if endswith(arn, "/pilo-db-migrations")
  ])
  s3_bucket_arns                      = [module.s3.frontend_bucket_arn, module.s3.uploads_bucket_arn]
  sqs_queue_arns                      = module.sqs.queue_arns
  ai_worker_queue_arns                = [module.sqs.ai_jobs_queue_arn]
  agent_worker_queue_arns             = [module.sqs.agent_jobs_queue_arn]
  meeting_worker_queue_arns           = [module.sqs.meeting_jobs_queue_arn]
  pr_review_ai_worker_queue_arns      = [module.sqs.pr_review_analysis_queue_arn]
  workspace_indexer_worker_queue_arns = [module.sqs.workspace_indexing_queue_arn]
  github_sync_worker_queue_arns       = module.sqs.github_sync_worker_queue_arns
  github_webhooks_queue_arn           = module.sqs.github_webhooks_queue_arn
  github_sync_operator_user_name      = "pilo-juhyung-github-ops"
  team_administrator_user_names       = ["pilo-donghyun", "pilo-sein", "pilo-jinho"]
  github_sync_operator_dlq_arns       = module.sqs.github_sync_worker_dlq_arns
  github_sync_operator_log_group_arn  = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/github-sync-worker"
  secrets_manager_arns                = concat(module.secrets.secret_arns, [module.rds.master_user_secret_arn])
  cloudfront_distribution             = module.cloudfront.distribution_arn
  terraform_plan_state_bucket_arn     = "arn:aws:s3:::${module.terraform_state.state_bucket_name}"
  terraform_plan_state_key            = "infra/dev/terraform.tfstate"
}

module "rds" {
  source = "../../modules/rds"

  name_prefix         = local.name_prefix
  subnet_ids          = module.network.private_subnet_ids
  security_group_ids  = [module.security_groups.rds_security_group_id]
  instance_class      = var.rds_instance_class
  allocated_storage   = var.rds_allocated_storage
  deletion_protection = var.rds_deletion_protection
}

module "redis" {
  source = "../../modules/redis"

  name_prefix        = local.name_prefix
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.security_groups.redis_security_group_id]
  node_type          = var.redis_node_type
}

module "alb" {
  source = "../../modules/alb"

  name_prefix           = local.name_prefix
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  alb_security_group_id = module.security_groups.alb_security_group_id
  app_server_port       = var.app_server_port
  realtime_server_port  = var.realtime_server_port
  api_certificate_arn   = module.route53_acm.alb_certificate_arn
  create_https_listener = var.create_dns_records
}

module "ecs" {
  source = "../../modules/ecs"

  depends_on = [module.alb]

  name_prefix           = local.name_prefix
  aws_region            = var.aws_region
  subnet_ids            = module.network.public_subnet_ids
  assign_public_ip      = var.ecs_assign_public_ip
  execution_role_arn    = module.iam.ecs_task_execution_role_arn
  log_retention_in_days = var.log_retention_in_days

  services = {
    app-server = {
      image              = "${module.ecr.repository_urls["pilo-app-server"]}:latest"
      cpu                = var.app_server_cpu
      memory             = var.app_server_memory
      desired_count      = var.app_server_desired_count
      container_port     = var.app_server_port
      security_group_ids = [module.security_groups.app_server_security_group_id]
      task_role_arn      = module.iam.app_server_task_role_arn
      target_group_arn   = module.alb.app_target_group_arn
      environment = {
        APP_ENV                                = var.environment
        AWS_REGION                             = var.aws_region
        PORT                                   = tostring(var.app_server_port)
        DATABASE_SSL                           = "true"
        DATABASE_POOL_MAX                      = "2"
        DATABASE_POOL_IDLE_TIMEOUT_MS          = "10000"
        DATABASE_POOL_CONNECTION_TIMEOUT_MS    = "5000"
        DATABASE_APPLICATION_NAME              = "pilo-dev-app-server"
        S3_UPLOADS_BUCKET                      = module.s3.uploads_bucket_name
        SQS_AI_JOBS_QUEUE_URL                  = module.sqs.ai_jobs_queue_url
        SQS_AGENT_JOBS_QUEUE_URL               = module.sqs.agent_jobs_queue_url
        SQS_MEETING_JOBS_QUEUE_URL             = module.sqs.meeting_jobs_queue_url
        SQS_PR_REVIEW_ANALYSIS_QUEUE_URL       = module.sqs.pr_review_analysis_queue_url
        SQS_GITHUB_WEBHOOKS_QUEUE_URL          = module.sqs.github_webhooks_queue_url
        SQS_GITHUB_SYNC_JOBS_QUEUE_URL         = module.sqs.github_sync_jobs_queue_url
        GITHUB_MANUAL_SYNC_USER_LIMIT          = tostring(var.github_manual_sync_user_limit)
        GITHUB_MANUAL_SYNC_WORKSPACE_LIMIT     = tostring(var.github_manual_sync_workspace_limit)
        GITHUB_MANUAL_SYNC_RATE_WINDOW_SECONDS = tostring(var.github_manual_sync_rate_window_seconds)
        GITHUB_MANUAL_SYNC_COOLDOWN_SECONDS    = tostring(var.github_manual_sync_cooldown_seconds)
        GITHUB_MANUAL_SYNC_MAX_QUEUED_JOBS     = tostring(var.github_manual_sync_max_queued_jobs)
        SQS_WORKSPACE_INDEXING_QUEUE_URL       = module.sqs.workspace_indexing_queue_url
        FRONTEND_URL                           = local.frontend_domain == "" ? "" : "https://${local.frontend_domain}"
        API_PUBLIC_ORIGIN                      = local.api_domain == "" ? "http://${module.alb.alb_dns_name}" : "https://${local.api_domain}"
        API_BASE_PATH                          = "/api/v1"
        LIVEKIT_RECORDING_MODE                 = "room_audio_only"
        LIVEKIT_EGRESS_S3_PREFIX               = "recordings/meetings"
        OPENAI_PR_REVIEW_MODEL                 = "gpt-5.5"
        OPENAI_PR_REVIEW_TIMEOUT_MS            = "45000"
        SQL_ERD_OPERATIONS_V1_ENABLED          = tostring(var.sql_erd_operations_v1_enabled)
        AGENT_PLANNING_TIMEOUT_SECONDS         = tostring(local.agent_planning_timeout_seconds)
        AGENT_EXECUTION_LEASE_SECONDS          = tostring(local.agent_execution_lease_seconds)
        AGENT_EXECUTION_HEARTBEAT_SECONDS      = tostring(local.agent_execution_heartbeat_seconds)
        AGENT_GROUNDED_ANSWER_TIMEOUT_SECONDS  = tostring(local.agent_grounded_answer_timeout_seconds)
        OPENAI_QUERY_EMBEDDING_TIMEOUT_MS      = "10000"
        MEETING_RAG_MIN_SIMILARITY             = "0.23"
        DRIVE_RAG_MIN_SIMILARITY               = "0.27"
        AGENT_DOMAIN_MEETING_READ_ENABLED      = "true"
        AGENT_DOMAIN_MEETING_WRITE_ENABLED     = "true"
        AGENT_DOMAIN_CALENDAR_READ_ENABLED     = "true"
        AGENT_DOMAIN_CALENDAR_WRITE_ENABLED    = "true"
        AGENT_DOMAIN_BOARD_READ_ENABLED        = "true"
        AGENT_DOMAIN_BOARD_WRITE_ENABLED       = "true"
        AGENT_DOMAIN_CANVAS_READ_ENABLED       = "true"
        AGENT_DOMAIN_CANVAS_WRITE_ENABLED      = "true"
        AGENT_DOMAIN_SQL_ERD_READ_ENABLED      = "true"
        AGENT_DOMAIN_SQL_ERD_WRITE_ENABLED     = "true"
        AGENT_DOMAIN_DRIVE_READ_ENABLED        = "true"
        AGENT_DOMAIN_DRIVE_WRITE_ENABLED       = "true"
        AGENT_DOMAIN_PR_REVIEW_READ_ENABLED    = "true"
        AGENT_DOMAIN_PR_REVIEW_WRITE_ENABLED   = "true"
      }
      secrets = module.secrets.app_server_ecs_secrets
    }

    realtime-server = {
      image              = "${module.ecr.repository_urls["pilo-realtime-server"]}:latest"
      cpu                = var.realtime_server_cpu
      memory             = var.realtime_server_memory
      desired_count      = var.realtime_server_desired_count
      container_port     = var.realtime_server_port
      security_group_ids = [module.security_groups.realtime_server_security_group_id]
      task_role_arn      = module.iam.realtime_server_task_role_arn
      target_group_arn   = module.alb.realtime_target_group_arn
      environment = {
        APP_ENV                             = var.environment
        AWS_REGION                          = var.aws_region
        PORT                                = tostring(var.realtime_server_port)
        DATABASE_SSL                        = "true"
        DATABASE_POOL_MAX                   = "1"
        DATABASE_POOL_IDLE_TIMEOUT_MS       = "10000"
        DATABASE_POOL_CONNECTION_TIMEOUT_MS = "5000"
        DATABASE_APPLICATION_NAME           = "pilo-dev-realtime-server"
        APP_SERVER_URL                      = local.api_domain == "" ? "http://${module.alb.alb_dns_name}/api/v1" : "https://${local.api_domain}/api/v1"
        SOCKET_IO_CORS_ORIGIN               = local.frontend_domain == "" ? "*" : "https://${local.frontend_domain}"
      }
      secrets = module.secrets.realtime_server_ecs_secrets
    }

    ai-worker = {
      image              = "${module.ecr.repository_urls["pilo-ai-worker"]}:latest"
      cpu                = var.ai_worker_cpu
      memory             = var.ai_worker_memory
      desired_count      = var.ai_worker_desired_count
      container_port     = null
      command            = ["python", "-m", "app.shared_ai_worker_runtime"]
      security_group_ids = [module.security_groups.ai_worker_security_group_id]
      task_role_arn      = module.iam.ai_worker_task_role_arn
      target_group_arn   = null
      environment = merge({
        APP_ENV                                   = var.environment
        AWS_REGION                                = var.aws_region
        DATABASE_SSL                              = "true"
        S3_UPLOADS_BUCKET                         = module.s3.uploads_bucket_name
        SQS_AI_JOBS_QUEUE_URL                     = module.sqs.ai_jobs_queue_url
        SQS_GITHUB_WEBHOOKS_QUEUE_URL             = module.sqs.github_webhooks_queue_url
        AGENT_TOOL_RETRIEVAL_MODE                 = "llm_router"
        OPENAI_AGENT_PLANNER_TIMEOUT_MS           = tostring(local.agent_planner_timeout_ms)
        OPENAI_AGENT_ROUTER_TIMEOUT_MS            = tostring(local.agent_router_timeout_ms)
        OPENAI_CANVAS_HTML_TIMEOUT_MS             = tostring(local.canvas_html_timeout_ms)
        OPENAI_INDEXING_EMBEDDING_TIMEOUT_SECONDS = "30"
        LEGACY_MEETING_DRAIN_ENABLED              = tostring(var.legacy_meeting_drain_enabled)
        LEGACY_AGENT_DRAIN_ENABLED                = tostring(var.legacy_agent_drain_enabled)
        }, var.legacy_meeting_drain_enabled ? {
        S3_RECORDINGS_BUCKET                 = module.s3.uploads_bucket_name
        MEETING_REPORT_EVENT_BASE_URL        = local.api_domain == "" ? "http://${module.alb.alb_dns_name}" : "https://${local.api_domain}"
        MEETING_REPORT_EVENT_TIMEOUT_SECONDS = "10"
        MEETING_REPORT_EVENT_MAX_ATTEMPTS    = "3"
        OPENAI_STT_MODEL                     = "whisper-1"
        OPENAI_MEETING_REPORT_MODEL          = "gpt-5.4-mini"
        } : {}, var.legacy_agent_drain_enabled ? {
        AGENT_EXECUTION_HANDOFF_BASE_URL        = local.api_domain == "" ? "http://${module.alb.alb_dns_name}" : "https://${local.api_domain}"
        AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS = tostring(local.agent_handoff_timeout_seconds)
      } : {})
      secrets = merge(
        var.legacy_meeting_drain_enabled ? module.secrets.ai_worker_legacy_meeting_drain_ecs_secrets : module.secrets.ai_worker_ecs_secrets,
        var.legacy_agent_drain_enabled ? { AGENT_EXECUTION_HANDOFF_TOKEN = module.secrets.agent_worker_ecs_secrets["AGENT_EXECUTION_HANDOFF_TOKEN"] } : {},
      )
    }

    agent-worker = {
      image              = "${module.ecr.repository_urls["pilo-ai-worker"]}:latest"
      cpu                = var.ai_worker_cpu
      memory             = var.ai_worker_memory
      desired_count      = var.agent_worker_desired_count
      container_port     = null
      command            = ["python", "-m", "app.agent_worker_runtime"]
      security_group_ids = [module.security_groups.ai_worker_security_group_id]
      task_role_arn      = module.iam.agent_worker_task_role_arn
      target_group_arn   = null
      environment = {
        APP_ENV                                    = var.environment
        AWS_REGION                                 = var.aws_region
        DATABASE_SSL                               = "true"
        SQS_AGENT_JOBS_QUEUE_URL                   = module.sqs.agent_jobs_queue_url
        AGENT_EXECUTION_HANDOFF_BASE_URL           = local.api_domain == "" ? "http://${module.alb.alb_dns_name}" : "https://${local.api_domain}"
        AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS    = tostring(local.agent_handoff_timeout_seconds)
        OPENAI_AGENT_PLANNER_TIMEOUT_MS            = tostring(local.agent_planner_timeout_ms)
        OPENAI_AGENT_ROUTER_TIMEOUT_MS             = tostring(local.agent_router_timeout_ms)
        AGENT_TOOL_RETRIEVAL_MODE                  = "llm_router"
        AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS   = tostring(local.agent_sqs_visibility_timeout_seconds)
        AI_WORKER_SQS_VISIBILITY_HEARTBEAT_SECONDS = tostring(local.agent_sqs_visibility_heartbeat_seconds)
      }
      secrets = module.secrets.agent_worker_ecs_secrets
    }

    meeting-worker = {
      image              = "${module.ecr.repository_urls["pilo-ai-worker"]}:latest"
      cpu                = var.ai_worker_cpu
      memory             = var.ai_worker_memory
      desired_count      = var.meeting_worker_desired_count
      container_port     = null
      command            = ["python", "-m", "app.meeting_worker_runtime"]
      security_group_ids = [module.security_groups.ai_worker_security_group_id]
      task_role_arn      = module.iam.meeting_worker_task_role_arn
      target_group_arn   = null
      environment = {
        APP_ENV                                  = var.environment
        AWS_REGION                               = var.aws_region
        DATABASE_SSL                             = "true"
        S3_RECORDINGS_BUCKET                     = module.s3.uploads_bucket_name
        SQS_MEETING_JOBS_QUEUE_URL               = module.sqs.meeting_jobs_queue_url
        MEETING_REPORT_EVENT_BASE_URL            = local.api_domain == "" ? "http://${module.alb.alb_dns_name}" : "https://${local.api_domain}"
        MEETING_REPORT_EVENT_TIMEOUT_SECONDS     = "10"
        MEETING_REPORT_EVENT_MAX_ATTEMPTS        = "3"
        OPENAI_STT_MODEL                         = "whisper-1"
        OPENAI_MEETING_REPORT_MODEL              = "gpt-5.4-mini"
        AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS = "900"
      }
      secrets = module.secrets.meeting_worker_ecs_secrets
    }

    pr-review-ai-worker = {
      image              = "${module.ecr.repository_urls["pilo-ai-worker"]}:latest"
      cpu                = var.ai_worker_cpu
      memory             = var.ai_worker_memory
      desired_count      = var.pr_review_ai_worker_desired_count
      container_port     = null
      command            = ["python", "-m", "app.pr_review_analysis_runtime"]
      security_group_ids = [module.security_groups.ai_worker_security_group_id]
      task_role_arn      = module.iam.pr_review_ai_worker_task_role_arn
      target_group_arn   = null
      environment = {
        APP_ENV                                    = var.environment
        AWS_REGION                                 = var.aws_region
        SQS_PR_REVIEW_ANALYSIS_QUEUE_URL           = module.sqs.pr_review_analysis_queue_url
        PR_REVIEW_ANALYSIS_HANDOFF_BASE_URL        = local.api_domain == "" ? "http://${module.alb.alb_dns_name}" : "https://${local.api_domain}"
        PR_REVIEW_ANALYSIS_HANDOFF_TIMEOUT_SECONDS = "10"
        OPENAI_PR_REVIEW_MODEL                     = "gpt-5.5"
        OPENAI_PR_REVIEW_TIMEOUT_MS                = "180000"
        AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS   = "900"
      }
      secrets = module.secrets.pr_review_ai_worker_ecs_secrets
    }

    workspace-indexer-worker = {
      image              = "${module.ecr.repository_urls["pilo-ai-worker"]}:latest"
      cpu                = var.ai_worker_cpu
      memory             = var.ai_worker_memory
      desired_count      = 1
      container_port     = null
      command            = ["python", "-m", "app.workspace_indexing_worker_runtime"]
      security_group_ids = [module.security_groups.ai_worker_security_group_id]
      task_role_arn      = module.iam.workspace_indexer_worker_task_role_arn
      target_group_arn   = null
      environment = {
        APP_ENV                                   = var.environment
        AWS_REGION                                = var.aws_region
        DATABASE_SSL                              = "true"
        SQS_WORKSPACE_INDEXING_QUEUE_URL          = module.sqs.workspace_indexing_queue_url
        OPENAI_WORKSPACE_INDEXING_EMBEDDING_MODEL = "text-embedding-3-small"
        OPENAI_INDEXING_EMBEDDING_TIMEOUT_SECONDS = "30"
        AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS  = "900"
      }
      secrets = module.secrets.workspace_indexer_worker_ecs_secrets
    }

    github-sync-worker = {
      image              = "${module.ecr.repository_urls["pilo-app-server"]}:latest"
      cpu                = var.app_server_cpu
      memory             = var.app_server_memory
      desired_count      = var.github_sync_worker_desired_count
      container_port     = null
      command            = ["node", "dist/github-sync-worker-main.js"]
      security_group_ids = [module.security_groups.app_server_security_group_id]
      task_role_arn      = module.iam.github_sync_worker_task_role_arn
      target_group_arn   = null
      environment = {
        APP_ENV                             = var.environment
        AWS_REGION                          = var.aws_region
        DATABASE_SSL                        = "true"
        DATABASE_POOL_MAX                   = "1"
        DATABASE_POOL_IDLE_TIMEOUT_MS       = "10000"
        DATABASE_POOL_CONNECTION_TIMEOUT_MS = "5000"
        DATABASE_APPLICATION_NAME           = "pilo-dev-github-sync-worker"
        API_PUBLIC_ORIGIN                   = local.api_domain == "" ? "http://${module.alb.alb_dns_name}" : "https://${local.api_domain}"
        SQS_GITHUB_WEBHOOKS_QUEUE_URL       = module.sqs.github_webhooks_queue_url
        SQS_GITHUB_SYNC_JOBS_QUEUE_URL      = module.sqs.github_sync_jobs_queue_url
      }
      secrets = module.secrets.github_sync_worker_ecs_secrets
    }
  }
}

module "db_migrations" {
  source = "../../modules/db-migrations"

  name_prefix           = local.name_prefix
  aws_region            = var.aws_region
  image                 = "${module.ecr.repository_urls["pilo-db-migrations"]}:latest"
  execution_role_arn    = module.iam.ecs_task_execution_role_arn
  database_host         = module.rds.address
  database_port         = module.rds.port
  database_name         = module.rds.database_name
  database_secret_arn   = module.rds.master_user_secret_arn
  log_retention_in_days = var.log_retention_in_days
}

module "github_sync_observability" {
  source = "../../modules/github-sync-observability"

  depends_on = [module.ecs]

  name_prefix = local.name_prefix
}

module "meeting_observability" {
  source = "../../modules/meeting-observability"

  depends_on = [module.ecs, module.sqs]

  name_prefix = local.name_prefix
}

module "agent_observability" {
  source = "../../modules/agent-observability"

  depends_on = [module.ecs, module.sqs]

  name_prefix = local.name_prefix
}

module "pr_review_observability" {
  source = "../../modules/pr-review-observability"

  depends_on = [module.ecs, module.sqs]

  name_prefix = local.name_prefix
}

resource "aws_route53_record" "frontend" {
  count = var.create_dns_records ? 1 : 0

  zone_id = var.hosted_zone_id
  name    = var.frontend_domain_name
  type    = "A"

  allow_overwrite = true

  alias {
    name                   = module.cloudfront.distribution_domain_name
    zone_id                = module.cloudfront.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  count = var.create_dns_records ? 1 : 0

  zone_id = var.hosted_zone_id
  name    = var.api_domain_name
  type    = "A"

  allow_overwrite = true

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }
}
