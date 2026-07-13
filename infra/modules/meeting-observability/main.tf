locals {
  queue_name          = "${var.name_prefix}-meeting-jobs"
  dlq_name            = "${var.name_prefix}-meeting-jobs-dlq"
  ecs_cluster_name    = "${var.name_prefix}-cluster"
  worker_service_name = "${var.name_prefix}-meeting-worker"
}

resource "aws_cloudwatch_metric_alarm" "queue_oldest_age" {
  alarm_name          = "${var.name_prefix}-meeting-jobs-oldest-age"
  alarm_description   = "MeetingReport queue oldest message age is at or above 600 seconds."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 600
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = local.queue_name
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_backlog" {
  alarm_name          = "${var.name_prefix}-meeting-jobs-backlog"
  alarm_description   = "MeetingReport queue visible backlog is at or above 10."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = local.queue_name
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_backlog" {
  alarm_name          = "${var.name_prefix}-meeting-jobs-dlq-backlog"
  alarm_description   = "MeetingReport DLQ has at least one visible message."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = local.dlq_name
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_running_task_count" {
  alarm_name          = "${var.name_prefix}-meeting-worker-running-tasks"
  alarm_description   = "MeetingReport worker has fewer than one running task for two minutes."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = local.ecs_cluster_name
    ServiceName = local.worker_service_name
  }
}
