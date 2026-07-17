variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "github_owner" {
  type    = string
  default = ""
}

variable "github_repo" {
  type    = string
  default = ""
}

variable "ecr_repository_arns" {
  type = list(string)
}

variable "s3_bucket_arns" {
  type = list(string)
}

variable "sqs_queue_arns" {
  type = list(string)
}

variable "ai_worker_queue_arns" {
  description = "Queues consumed by the shared Agent and Canvas AI worker."
  type        = list(string)
}

variable "agent_worker_queue_arns" {
  type = list(string)
}

variable "meeting_worker_queue_arns" {
  description = "Queues consumed by the MeetingReport-only worker."
  type        = list(string)
}

variable "pr_review_ai_worker_queue_arns" {
  description = "Queues consumed by the PR Review-only worker."
  type        = list(string)
}

variable "workspace_indexer_worker_queue_arns" {
  description = "Queues consumed by the Workspace indexing worker."
  type        = list(string)
}

variable "github_sync_worker_queue_arns" {
  type = list(string)
}

variable "github_webhooks_queue_arn" {
  type = string
}

variable "github_sync_operator_user_name" {
  description = "Optional IAM user name for GitHub Sync queue and log operations."
  type        = string
  default     = ""
}

variable "team_administrator_user_names" {
  description = "IAM user names to create with direct AdministratorAccess for team operations."
  type        = set(string)
  default     = []
}

variable "github_sync_operator_dlq_arns" {
  description = "GitHub Sync dead-letter queue ARNs available to the operator."
  type        = list(string)
  default     = []
}

variable "github_sync_operator_log_group_arn" {
  description = "CloudWatch log group ARN available to the GitHub Sync operator."
  type        = string
  default     = ""
}

variable "secrets_manager_arns" {
  type = list(string)
}

variable "cloudfront_distribution" {
  type = string
}

variable "terraform_plan_state_bucket_arn" {
  description = "S3 bucket ARN for the remote Terraform state that GitHub Actions plan jobs may read."
  type        = string
}

variable "terraform_plan_state_key" {
  description = "Remote Terraform state object key used by GitHub Actions plan jobs."
  type        = string
}

variable "github_oidc_thumbprints" {
  description = "GitHub Actions OIDC thumbprint list. Verify before production use."
  type        = list(string)
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
