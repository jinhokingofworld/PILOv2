resource "aws_sqs_queue" "ai_jobs_dlq" {
  name                      = "${var.name_prefix}-ai-jobs-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "ai_jobs" {
  name                       = "${var.name_prefix}-ai-jobs"
  visibility_timeout_seconds = var.visibility_timeout_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ai_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "meeting_jobs_dlq" {
  name                      = "${var.name_prefix}-meeting-jobs-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "meeting_jobs" {
  name                       = "${var.name_prefix}-meeting-jobs"
  visibility_timeout_seconds = 900

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.meeting_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "pr_review_analysis_dlq" {
  name                      = "${var.name_prefix}-pr-review-analysis-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "pr_review_analysis" {
  name                       = "${var.name_prefix}-pr-review-analysis"
  visibility_timeout_seconds = 900

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.pr_review_analysis_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "github_webhooks_dlq" {
  name                      = "${var.name_prefix}-github-webhooks-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "github_webhooks" {
  name                       = "${var.name_prefix}-github-webhooks"
  visibility_timeout_seconds = 120

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.github_webhooks_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "github_sync_jobs_dlq" {
  name                      = "${var.name_prefix}-github-sync-jobs-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "github_sync_jobs" {
  name                       = "${var.name_prefix}-github-sync-jobs"
  visibility_timeout_seconds = 900

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.github_sync_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}
