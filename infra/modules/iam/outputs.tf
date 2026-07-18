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

output "agent_worker_task_role_arn" {
  value = aws_iam_role.agent_worker_task.arn
}

output "pr_review_ai_worker_task_role_arn" {
  value = aws_iam_role.pr_review_ai_worker_task.arn
}

output "workspace_indexer_worker_task_role_arn" {
  value = aws_iam_role.workspace_indexer_worker_task.arn
}

output "github_sync_worker_task_role_arn" {
  value = aws_iam_role.github_sync_worker_task.arn
}

output "github_actions_role_arn" {
  value = try(aws_iam_role.github_actions[0].arn, "")
}

output "github_actions_db_migration_publisher_role_arn" {
  value = try(aws_iam_role.github_actions_db_migration_publisher[0].arn, "")
}

output "github_actions_terraform_plan_role_arn" {
  value = try(aws_iam_role.github_actions_terraform_plan[0].arn, "")
}

output "github_sync_operator_user_name" {
  value = try(aws_iam_user.github_sync_operator[0].name, "")
}

output "github_sync_operator_user_arn" {
  value = try(aws_iam_user.github_sync_operator[0].arn, "")
}

output "team_administrator_user_names" {
  value = sort(keys(aws_iam_user.team_administrator))
}
