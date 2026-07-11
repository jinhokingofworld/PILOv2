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

variable "github_sync_worker_queue_arns" {
  type = list(string)
}

variable "github_webhooks_queue_arn" {
  type = string
}

variable "secrets_manager_arns" {
  type = list(string)
}

variable "cloudfront_distribution" {
  type = string
}

variable "github_oidc_thumbprints" {
  description = "GitHub Actions OIDC thumbprint list. Verify before production use."
  type        = list(string)
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
