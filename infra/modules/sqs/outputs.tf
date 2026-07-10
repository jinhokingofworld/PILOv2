output "ai_jobs_queue_url" {
  value = aws_sqs_queue.ai_jobs.url
}

output "agent_jobs_queue_url" {
  value = aws_sqs_queue.agent_jobs.url
}

output "github_webhooks_queue_url" {
  value = aws_sqs_queue.github_webhooks.url
}

output "queue_arns" {
  value = [
    aws_sqs_queue.ai_jobs.arn,
    aws_sqs_queue.ai_jobs_dlq.arn,
    aws_sqs_queue.agent_jobs.arn,
    aws_sqs_queue.agent_jobs_dlq.arn,
    aws_sqs_queue.github_webhooks.arn,
    aws_sqs_queue.github_webhooks_dlq.arn,
  ]
}
