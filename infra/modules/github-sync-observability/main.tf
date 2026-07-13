locals {
  metric_namespace                  = "PILO/GitHubSync"
  github_sync_worker_log_group_name = "/ecs/${var.name_prefix}/github-sync-worker"
  github_sync_worker_service_name   = "${var.name_prefix}-github-sync-worker"
  ecs_cluster_name                  = "${var.name_prefix}-cluster"

  queue_oldest_age_alarms = {
    webhook_warning = {
      queue_name = "${var.name_prefix}-github-webhooks"
      threshold  = 60
    }
    webhook_critical = {
      queue_name = "${var.name_prefix}-github-webhooks"
      threshold  = 300
    }
    sync_jobs_warning = {
      queue_name = "${var.name_prefix}-github-sync-jobs"
      threshold  = 600
    }
    sync_jobs_critical = {
      queue_name = "${var.name_prefix}-github-sync-jobs"
      threshold  = 1800
    }
  }

  queue_backlog_alarms = {
    webhook_warning = {
      queue_name = "${var.name_prefix}-github-webhooks"
      threshold  = 20
    }
    webhook_critical = {
      queue_name = "${var.name_prefix}-github-webhooks"
      threshold  = 100
    }
    sync_jobs_warning = {
      queue_name = "${var.name_prefix}-github-sync-jobs"
      threshold  = 10
    }
    sync_jobs_critical = {
      queue_name = "${var.name_prefix}-github-sync-jobs"
      threshold  = 50
    }
  }

  dlq_backlog_alarms = {
    webhook_warning = {
      queue_name = "${var.name_prefix}-github-webhooks-dlq"
      threshold  = 1
    }
    webhook_critical = {
      queue_name = "${var.name_prefix}-github-webhooks-dlq"
      threshold  = 10
    }
    sync_jobs_warning = {
      queue_name = "${var.name_prefix}-github-sync-jobs-dlq"
      threshold  = 1
    }
    sync_jobs_critical = {
      queue_name = "${var.name_prefix}-github-sync-jobs-dlq"
      threshold  = 10
    }
  }

  worker_running_task_alarms = {
    warning = {
      evaluation_periods = 2
    }
    critical = {
      evaluation_periods = 5
    }
  }

  operation_alarms = {
    retry_warning                     = {
      metric_name         = "RetryCount"
      statistic           = "Sum"
      comparison_operator = "GreaterThanOrEqualToThreshold"
      threshold           = 5
    }
    retry_critical                    = {
      metric_name         = "RetryCount"
      statistic           = "Sum"
      comparison_operator = "GreaterThanOrEqualToThreshold"
      threshold           = 20
    }
    terminal_failure_warning          = {
      metric_name         = "TerminalFailureCount"
      statistic           = "Sum"
      comparison_operator = "GreaterThanOrEqualToThreshold"
      threshold           = 1
    }
    terminal_failure_critical         = {
      metric_name         = "TerminalFailureCount"
      statistic           = "Sum"
      comparison_operator = "GreaterThanOrEqualToThreshold"
      threshold           = 5
    }
    rate_limit_remaining_warning      = {
      metric_name         = "RateLimitRemaining"
      statistic           = "Minimum"
      comparison_operator = "LessThanOrEqualToThreshold"
      threshold           = 100
    }
    rate_limit_remaining_critical     = {
      metric_name         = "RateLimitRemaining"
      statistic           = "Minimum"
      comparison_operator = "LessThanOrEqualToThreshold"
      threshold           = 0
    }
    database_pool_exhausted_warning = {
      metric_name         = "DatabasePoolExhaustedCount"
      statistic           = "Sum"
      comparison_operator = "GreaterThanOrEqualToThreshold"
      threshold           = 1
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "retry" {
  name           = "${var.name_prefix}-github-sync-retry"
  log_group_name = local.github_sync_worker_log_group_name
  pattern        = "{ $.event = \"github_sync_retry\" }"

  metric_transformation {
    name      = "RetryCount"
    namespace = local.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "terminal_failure" {
  name           = "${var.name_prefix}-github-sync-terminal-failure"
  log_group_name = local.github_sync_worker_log_group_name
  pattern        = "{ $.event = \"github_sync_terminal_failure\" }"

  metric_transformation {
    name      = "TerminalFailureCount"
    namespace = local.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "rate_limit_terminal_failure" {
  name           = "${var.name_prefix}-github-sync-rate-limit-terminal-failure"
  log_group_name = local.github_sync_worker_log_group_name
  pattern        = "{ $.event = \"github_sync_rate_limit_terminal_failure\" }"

  metric_transformation {
    name      = "TerminalFailureCount"
    namespace = local.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "rate_limit_remaining" {
  name           = "${var.name_prefix}-github-sync-rate-limit-remaining"
  log_group_name = local.github_sync_worker_log_group_name
  pattern        = "{ $.event = \"github_sync_rate_limit_observed\" && $.rateLimitRemaining >= 0 }"

  metric_transformation {
    name      = "RateLimitRemaining"
    namespace = local.metric_namespace
    value     = "$.rateLimitRemaining"
  }
}

resource "aws_cloudwatch_log_metric_filter" "database_pool_exhausted" {
  name           = "${var.name_prefix}-github-sync-database-pool-exhausted"
  log_group_name = local.github_sync_worker_log_group_name
  pattern        = "{ $.event = \"github_sync_worker_poll_retry\" && $.failureKind = \"database_session_pool_exhausted\" }"

  metric_transformation {
    name      = "DatabasePoolExhaustedCount"
    namespace = local.metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_oldest_age" {
  for_each = local.queue_oldest_age_alarms

  alarm_name          = "${var.name_prefix}-github-sync-${replace(each.key, "_", "-")}-oldest-age"
  alarm_description   = "GitHub sync queue oldest message age is at or above ${each.value.threshold} seconds."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = each.value.queue_name
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_backlog" {
  for_each = local.queue_backlog_alarms

  alarm_name          = "${var.name_prefix}-github-sync-${replace(each.key, "_", "-")}-backlog"
  alarm_description   = "GitHub sync queue visible backlog is at or above ${each.value.threshold}."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = each.value.queue_name
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_backlog" {
  for_each = local.dlq_backlog_alarms

  alarm_name          = "${var.name_prefix}-github-sync-${replace(each.key, "_", "-")}-dlq-backlog"
  alarm_description   = "GitHub sync DLQ visible backlog is at or above ${each.value.threshold}."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = each.value.queue_name
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_running_task_count" {
  for_each = local.worker_running_task_alarms

  alarm_name          = "${var.name_prefix}-github-sync-worker-running-tasks-${each.key}"
  alarm_description   = "GitHub sync worker has fewer than one running task for ${each.value.evaluation_periods} minute(s)."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = each.value.evaluation_periods
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = local.ecs_cluster_name
    ServiceName = local.github_sync_worker_service_name
  }
}

resource "aws_cloudwatch_metric_alarm" "operation" {
  for_each = local.operation_alarms

  alarm_name          = "${var.name_prefix}-github-sync-${replace(each.key, "_", "-")}"
  alarm_description   = "GitHub sync ${replace(each.key, "_", " ")} threshold is breached."
  comparison_operator = each.value.comparison_operator
  evaluation_periods  = 1
  metric_name         = each.value.metric_name
  namespace           = local.metric_namespace
  period              = 300
  statistic           = each.value.statistic
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"
}
