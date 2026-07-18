resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name_prefix}/db-migrations"
  retention_in_days = var.log_retention_in_days
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name_prefix}-db-migrations"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = var.execution_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "db-migrations"
      image     = var.image
      essential = true
      environment = [
        {
          name  = "PGHOST"
          value = var.database_host
        },
        {
          name  = "PGPORT"
          value = tostring(var.database_port)
        },
        {
          name  = "PGDATABASE"
          value = var.database_name
        },
        {
          name  = "PGSSLMODE"
          value = "require"
        },
        {
          name  = "MIGRATION_MODE"
          value = "apply"
        },
      ]
      secrets = [
        {
          name      = "PGUSER"
          valueFrom = "${var.database_secret_arn}:username::"
        },
        {
          name      = "PGPASSWORD"
          valueFrom = "${var.database_secret_arn}:password::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "runner"
        }
      }
    },
  ])
}
