output "ai_jobs_queue_url" {
  value = aws_sqs_queue.ai_jobs.url
}

output "pr_review_analysis_queue_url" {
  value = aws_sqs_queue.pr_review_analysis.url
}

output "pr_review_analysis_queue_arn" {
  value = aws_sqs_queue.pr_review_analysis.arn
}

output "github_webhooks_queue_url" {
  value = aws_sqs_queue.github_webhooks.url
}

output "github_webhooks_queue_arn" {
  value = aws_sqs_queue.github_webhooks.arn
}

output "github_sync_jobs_queue_url" {
  value = aws_sqs_queue.github_sync_jobs.url
}

output "github_sync_worker_queue_arns" {
  value = [aws_sqs_queue.github_webhooks.arn, aws_sqs_queue.github_sync_jobs.arn]
}

output "github_sync_worker_dlq_arns" {
  value = [aws_sqs_queue.github_webhooks_dlq.arn, aws_sqs_queue.github_sync_jobs_dlq.arn]
}

output "queue_arns" {
  value = [
    aws_sqs_queue.ai_jobs.arn,
    aws_sqs_queue.ai_jobs_dlq.arn,
    aws_sqs_queue.pr_review_analysis.arn,
    aws_sqs_queue.pr_review_analysis_dlq.arn,
    aws_sqs_queue.github_webhooks.arn,
    aws_sqs_queue.github_webhooks_dlq.arn,
    aws_sqs_queue.github_sync_jobs.arn,
    aws_sqs_queue.github_sync_jobs_dlq.arn,
  ]
}
