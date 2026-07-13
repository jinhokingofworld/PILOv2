output "ecs_task_execution_role_arn" {
  value = aws_iam_role.ecs_task_execution.arn
}

output "app_server_task_role_arn" {
  value = aws_iam_role.app_server_task.arn
}

output "realtime_server_task_role_arn" {
  value = aws_iam_role.realtime_server_task.arn
}

output "ai_worker_task_role_arn" {
  value = aws_iam_role.ai_worker_task.arn
}

output "meeting_worker_task_role_arn" {
  value = aws_iam_role.meeting_worker_task.arn
}

output "pr_review_ai_worker_task_role_arn" {
  value = aws_iam_role.pr_review_ai_worker_task.arn
}

output "github_sync_worker_task_role_arn" {
  value = aws_iam_role.github_sync_worker_task.arn
}

output "github_actions_role_arn" {
  value = try(aws_iam_role.github_actions[0].arn, "")
}

output "github_sync_operator_user_name" {
  value = try(aws_iam_user.github_sync_operator[0].name, "")
}

output "github_sync_operator_user_arn" {
  value = try(aws_iam_user.github_sync_operator[0].arn, "")
}
