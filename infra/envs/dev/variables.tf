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
