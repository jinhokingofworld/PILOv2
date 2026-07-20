variable "project_name" {
  description = "Project name used for AWS resource names."
  type        = string
  default     = "pilo"
}

variable "environment" {
  description = "Environment name."
  type        = string
  default     = "dev"
}

variable "sql_erd_operations_v1_enabled" {
  description = "Whether newly created SQLtoERD sessions use the operations_v1 write protocol."
  type        = bool
  default     = false
}

variable "aws_region" {
  description = "AWS region for dev resources."
  type        = string
  default     = "ap-northeast-2"
}

variable "domain_name" {
  description = "Root domain name. Leave empty to skip DNS/cert aliases."
  type        = string
  default     = ""
}

variable "frontend_domain_name" {
  description = "Frontend domain name, for example dev.pilo.example.com."
  type        = string
  default     = ""
}

variable "api_domain_name" {
  description = "API domain name, for example api.dev.pilo.example.com."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone id. Leave empty to skip DNS resources."
  type        = string
  default     = ""
}

variable "create_dns_records" {
  description = "Whether to create ACM certificates and Route53 records."
  type        = bool
  default     = false
}

variable "vpc_cidr" {
  description = "VPC CIDR block."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDR blocks."
  type        = list(string)
  default     = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDR blocks."
  type        = list(string)
  default     = ["10.20.10.0/24", "10.20.11.0/24"]
}

variable "enable_nat_gateway" {
  description = "Do not enable this in dev. Kept for future production migration."
  type        = bool
  default     = false
}

variable "ecs_assign_public_ip" {
  description = "Dev ECS tasks run in public subnets without NAT."
  type        = bool
  default     = true
}

variable "app_server_port" {
  description = "App Server container port."
  type        = number
  default     = 3000
}

variable "realtime_server_port" {
  description = "Realtime Server container port."
  type        = number
  default     = 3001
}

variable "ai_worker_port" {
  description = "AI Worker container port. Not exposed in dev ALB."
  type        = number
  default     = 8000
}

variable "app_server_desired_count" {
  description = "Dev app server task count."
  type        = number
  default     = 1
}

variable "realtime_server_desired_count" {
  description = "Dev realtime server task count."
  type        = number
  default     = 1
}

variable "ai_worker_desired_count" {
  description = "Dev AI worker task count."
  type        = number
  default     = 1
}

variable "legacy_meeting_drain_enabled" {
  description = "Keep the shared AI worker's MeetingReport processor enabled until the legacy ai-jobs queue is drained."
  type        = bool
  default     = true
}

variable "legacy_agent_drain_enabled" {
  description = "Keep Agent processing in shared ai-worker until legacy ai-jobs messages are drained."
  type        = bool
  default     = true
}

variable "agent_worker_desired_count" {
  description = "Dev Agent worker task count."
  type        = number
  default     = 1
}

variable "meeting_worker_desired_count" {
  description = "Dev MeetingReport-only worker task count."
  type        = number
  default     = 1
}

variable "pr_review_ai_worker_desired_count" {
  description = "Dev PR Review AI worker task count. Keep one worker running while PR Review analysis is enabled."
  type        = number
  default     = 1
}

variable "github_sync_worker_desired_count" {
  description = "Dev GitHub sync worker task count."
  type        = number
  default     = 1
}

variable "github_manual_sync_user_limit" {
  description = "Maximum new manual GitHub sync runs per user in each rate window."
  type        = number
  default     = 5

  validation {
    condition     = var.github_manual_sync_user_limit > 0
    error_message = "github_manual_sync_user_limit must be positive."
  }
}

variable "github_manual_sync_workspace_limit" {
  description = "Maximum new manual GitHub sync runs per Workspace in each rate window."
  type        = number
  default     = 10

  validation {
    condition     = var.github_manual_sync_workspace_limit > 0
    error_message = "github_manual_sync_workspace_limit must be positive."
  }
}

variable "github_manual_sync_rate_window_seconds" {
  description = "Rate-limit window in seconds for new manual GitHub sync runs."
  type        = number
  default     = 600

  validation {
    condition     = var.github_manual_sync_rate_window_seconds > 0
    error_message = "github_manual_sync_rate_window_seconds must be positive."
  }
}

variable "github_manual_sync_cooldown_seconds" {
  description = "Minimum seconds between new manual GitHub sync runs for a user or Workspace."
  type        = number
  default     = 30

  validation {
    condition     = var.github_manual_sync_cooldown_seconds > 0
    error_message = "github_manual_sync_cooldown_seconds must be positive."
  }
}

variable "github_manual_sync_max_queued_jobs" {
  description = "Maximum globally queued manual GitHub sync jobs before admission is rejected."
  type        = number
  default     = 100

  validation {
    condition     = var.github_manual_sync_max_queued_jobs > 0
    error_message = "github_manual_sync_max_queued_jobs must be positive."
  }
}

variable "app_server_cpu" {
  type    = number
  default = 256
}

variable "app_server_memory" {
  type    = number
  default = 512
}

variable "realtime_server_cpu" {
  type    = number
  default = 256
}

variable "realtime_server_memory" {
  type    = number
  default = 512
}

variable "ai_worker_cpu" {
  type    = number
  default = 512
}

variable "ai_worker_memory" {
  type    = number
  default = 1024
}

variable "rds_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "rds_allocated_storage" {
  type    = number
  default = 20
}

variable "rds_deletion_protection" {
  type    = bool
  default = false
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "livekit_instance_type" {
  description = "EC2 instance type for the self-hosted LiveKit MVP host."
  type        = string
  default     = "t3.small"
}

variable "livekit_ami_id" {
  description = "Pinned AMI ID for the LiveKit host. Change only for a planned host rotation."
  type        = string
}

variable "livekit_root_volume_size" {
  description = "Root EBS volume size in GiB for the self-hosted LiveKit MVP host."
  type        = number
  default     = 30
}

variable "livekit_allowed_cidr_blocks" {
  description = "Public CIDR ranges allowed to reach LiveKit HTTP, HTTPS, TURN, and media ports."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "github_owner" {
  description = "GitHub organization or user name for OIDC trust."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository name for OIDC trust."
  type        = string
  default     = ""
}

variable "log_retention_in_days" {
  type    = number
  default = 7
}
