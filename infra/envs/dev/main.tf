locals {
  name_prefix = "${var.project_name}-${var.environment}"

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
}

module "livekit_host" {
  source = "../../modules/livekit-host"

  name_prefix           = local.name_prefix
  vpc_id                = module.network.vpc_id
  subnet_id             = module.network.public_subnet_ids[0]
  recordings_bucket_arn = module.s3.uploads_bucket_arn
  livekit_secret_arns   = values(module.secrets.livekit_host_secret_arns)
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
  ]
}

module "sqs" {
  source = "../../modules/sqs"

  name_prefix = local.name_prefix
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix = local.name_prefix
}

module "iam" {
  source = "../../modules/iam"

  name_prefix             = local.name_prefix
  aws_region              = var.aws_region
  github_owner            = var.github_owner
  github_repo             = var.github_repo
  ecr_repository_arns     = module.ecr.repository_arns
  s3_bucket_arns          = [module.s3.frontend_bucket_arn, module.s3.uploads_bucket_arn]
  sqs_queue_arns          = module.sqs.queue_arns
  secrets_manager_arns    = concat(module.secrets.secret_arns, [module.rds.master_user_secret_arn])
  cloudfront_distribution = module.cloudfront.distribution_arn
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
        APP_ENV                       = var.environment
        AWS_REGION                    = var.aws_region
        PORT                          = tostring(var.app_server_port)
        S3_UPLOADS_BUCKET             = module.s3.uploads_bucket_name
        SQS_AI_JOBS_QUEUE_URL         = module.sqs.ai_jobs_queue_url
        SQS_GITHUB_WEBHOOKS_QUEUE_URL = module.sqs.github_webhooks_queue_url
        FRONTEND_URL                  = local.frontend_domain == "" ? "" : "https://${local.frontend_domain}"
        API_PUBLIC_ORIGIN             = local.api_domain == "" ? "http://${module.alb.alb_dns_name}" : "https://${local.api_domain}"
        API_BASE_PATH                 = "/api/v1"
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
        APP_ENV     = var.environment
        AWS_REGION  = var.aws_region
        PORT        = tostring(var.realtime_server_port)
        CORS_ORIGIN = local.frontend_domain == "" ? "*" : "https://${local.frontend_domain}"
      }
      secrets = module.secrets.realtime_server_ecs_secrets
    }

    ai-worker = {
      image              = "${module.ecr.repository_urls["pilo-ai-worker"]}:latest"
      cpu                = var.ai_worker_cpu
      memory             = var.ai_worker_memory
      desired_count      = var.ai_worker_desired_count
      container_port     = null
      security_group_ids = [module.security_groups.ai_worker_security_group_id]
      task_role_arn      = module.iam.ai_worker_task_role_arn
      target_group_arn   = null
      environment = {
        APP_ENV                       = var.environment
        AWS_REGION                    = var.aws_region
        S3_UPLOADS_BUCKET             = module.s3.uploads_bucket_name
        SQS_AI_JOBS_QUEUE_URL         = module.sqs.ai_jobs_queue_url
        SQS_GITHUB_WEBHOOKS_QUEUE_URL = module.sqs.github_webhooks_queue_url
        AI_WORKER_CONCURRENCY         = "1"
      }
      secrets = module.secrets.ai_worker_ecs_secrets
    }
  }
}

resource "aws_route53_record" "frontend" {
  count = var.create_dns_records ? 1 : 0

  zone_id = var.hosted_zone_id
  name    = var.frontend_domain_name
  type    = "A"

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

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }
}
