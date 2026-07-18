output "vpc_id" {
  value = module.network.vpc_id
}

output "public_subnet_ids" {
  value = module.network.public_subnet_ids
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "frontend_bucket_name" {
  value = module.s3.frontend_bucket_name
}

output "uploads_bucket_name" {
  value = module.s3.uploads_bucket_name
}

output "cloudfront_distribution_id" {
  value = module.cloudfront.distribution_id
}

output "cloudfront_domain_name" {
  value = module.cloudfront.distribution_domain_name
}

output "alb_dns_name" {
  value = module.alb.alb_dns_name
}

output "ecr_repository_urls" {
  value = module.ecr.repository_urls
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "ecs_service_names" {
  value = module.ecs.service_names
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "db_migration_task_definition_arn" {
  value = module.db_migrations.task_definition_arn
}

output "db_migration_log_group_name" {
  value = module.db_migrations.log_group_name
}

output "redis_endpoint" {
  value = module.redis.endpoint
}

output "github_actions_role_arn" {
  value = module.iam.github_actions_role_arn
}

output "db_migration_publisher_role_arn" {
  value = module.iam.github_actions_db_migration_publisher_role_arn
}

output "terraform_plan_role_arn" {
  value = module.iam.github_actions_terraform_plan_role_arn
}

output "livekit_instance_id" {
  value = module.livekit_host.instance_id
}

output "livekit_public_ip" {
  value = module.livekit_host.public_ip
}

output "livekit_public_dns" {
  value = module.livekit_host.public_dns
}

output "livekit_security_group_id" {
  value = module.livekit_host.security_group_id
}

output "terraform_state_bucket_name" {
  value = module.terraform_state.state_bucket_name
}

output "terraform_lock_table_name" {
  value = module.terraform_state.lock_table_name
}
