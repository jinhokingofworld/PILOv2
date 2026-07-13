locals {
  github_oidc_enabled                      = var.github_owner != "" && var.github_repo != ""
  s3_object_arns                           = [for arn in var.s3_bucket_arns : "${arn}/*"]
  terraform_plan_state_object_arn          = "${var.terraform_plan_state_bucket_arn}/${var.terraform_plan_state_key}"
  terraform_plan_state_lockfile_object_arn = "${local.terraform_plan_state_object_arn}.tflock"
  terraform_plan_bucket_arns               = concat(var.s3_bucket_arns, [var.terraform_plan_state_bucket_arn])
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${var.name_prefix}-ecs-task-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${var.name_prefix}-ecs-execution-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.secrets_manager_arns
      }
    ]
  })
}

resource "aws_iam_role" "app_server_task" {
  name               = "${var.name_prefix}-app-server-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "app_server_task" {
  name = "${var.name_prefix}-app-server-task-policy"
  role = aws_iam_role.app_server_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
        Resource = var.sqs_queue_arns
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = local.s3_object_arns
      }
    ]
  })
}

resource "aws_iam_role" "realtime_server_task" {
  name               = "${var.name_prefix}-realtime-server-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "realtime_server_task" {
  name = "${var.name_prefix}-realtime-server-task-policy"
  role = aws_iam_role.realtime_server_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = local.s3_object_arns
      }
    ]
  })
}

resource "aws_iam_role" "ai_worker_task" {
  name               = "${var.name_prefix}-ai-worker-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "ai_worker_task" {
  name = "${var.name_prefix}-ai-worker-task-policy"
  role = aws_iam_role.ai_worker_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = var.ai_worker_queue_arns
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = local.s3_object_arns
      }
    ]
  })
}

resource "aws_iam_role" "meeting_worker_task" {
  name               = "${var.name_prefix}-meeting-worker-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role" "agent_worker_task" {
  name               = "${var.name_prefix}-agent-worker-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "agent_worker_task" {
  name = "${var.name_prefix}-agent-worker-task-policy"
  role = aws_iam_role.agent_worker_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl", "sqs:ChangeMessageVisibility"
      ]
      Resource = var.agent_worker_queue_arns
    }]
  })
}

resource "aws_iam_role_policy" "meeting_worker_task" {
  name = "${var.name_prefix}-meeting-worker-task-policy"
  role = aws_iam_role.meeting_worker_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = var.meeting_worker_queue_arns
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = local.s3_object_arns
      }
    ]
  })
}

resource "aws_iam_role" "pr_review_ai_worker_task" {
  name               = "${var.name_prefix}-pr-review-ai-worker-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "pr_review_ai_worker_task" {
  name = "${var.name_prefix}-pr-review-ai-worker-task-policy"
  role = aws_iam_role.pr_review_ai_worker_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl",
        "sqs:ChangeMessageVisibility"
      ]
      Resource = var.pr_review_ai_worker_queue_arns
    }]
  })
}

resource "aws_iam_role" "github_sync_worker_task" {
  name               = "${var.name_prefix}-github-sync-worker-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "github_sync_worker_task" {
  name = "${var.name_prefix}-github-sync-worker-task-policy"
  role = aws_iam_role.github_sync_worker_task.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow"
    Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ChangeMessageVisibility"]
    Resource = var.github_sync_worker_queue_arns
    }, {
    Effect   = "Allow"
    Action   = ["sqs:SendMessage"]
    Resource = var.github_webhooks_queue_arn
  }] })
}

resource "aws_iam_user" "github_sync_operator" {
  count = var.github_sync_operator_user_name == "" ? 0 : 1

  name = var.github_sync_operator_user_name

  # Preserve operational tags managed outside Terraform without exposing them in source control.
  lifecycle {
    ignore_changes = [tags]
  }
}

resource "aws_iam_policy" "github_sync_operator" {
  count = var.github_sync_operator_user_name == "" ? 0 : 1

  name        = "${var.name_prefix}-github-sync-operator"
  description = "Least-privilege GitHub Sync queue redrive and worker log access."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListQueues"
        Effect   = "Allow"
        Action   = ["sqs:ListQueues"]
        Resource = "*"
      },
      {
        Sid    = "InspectGithubSyncQueues"
        Effect = "Allow"
        Action = [
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
        ]
        Resource = concat(var.github_sync_worker_queue_arns, var.github_sync_operator_dlq_arns)
      },
      {
        Sid    = "RedriveGithubSyncDeadLetters"
        Effect = "Allow"
        Action = [
          "sqs:StartMessageMoveTask",
          "sqs:ListMessageMoveTasks",
          "sqs:CancelMessageMoveTask",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
        ]
        Resource = var.github_sync_operator_dlq_arns
      },
      {
        Sid      = "MoveGithubSyncDeadLetterMessages"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = var.github_sync_operator_dlq_arns
      },
      {
        Sid    = "ReadGithubSyncWorkerLogs"
        Effect = "Allow"
        Action = [
          "logs:DescribeLogStreams",
          "logs:GetLogEvents",
          "logs:FilterLogEvents",
          "logs:StartQuery",
        ]
        Resource = [
          var.github_sync_operator_log_group_arn,
          "${var.github_sync_operator_log_group_arn}:*",
        ]
      },
      {
        Sid    = "ReadGithubSyncLogQueryResults"
        Effect = "Allow"
        Action = [
          "logs:DescribeLogGroups",
          "logs:GetQueryResults",
          "logs:StopQuery",
          "cloudwatch:GetMetricData",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_user_policy_attachment" "github_sync_operator" {
  count = var.github_sync_operator_user_name == "" ? 0 : 1

  user       = aws_iam_user.github_sync_operator[0].name
  policy_arn = aws_iam_policy.github_sync_operator[0].arn
}

resource "aws_iam_user_policy_attachment" "github_sync_operator_change_password" {
  count = var.github_sync_operator_user_name == "" ? 0 : 1

  user       = aws_iam_user.github_sync_operator[0].name
  policy_arn = "arn:aws:iam::aws:policy/IAMUserChangePassword"
}

resource "aws_iam_user_policy" "github_sync_operator_self_mfa" {
  count = var.github_sync_operator_user_name == "" ? 0 : 1

  name = "${var.name_prefix}-github-sync-operator-self-mfa"
  user = aws_iam_user.github_sync_operator[0].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListVirtualMfaDevices"
        Effect   = "Allow"
        Action   = ["iam:ListVirtualMFADevices"]
        Resource = "*"
      },
      {
        Sid      = "CreateVirtualMfaDevice"
        Effect   = "Allow"
        Action   = ["iam:CreateVirtualMFADevice"]
        Resource = "arn:aws:iam::*:mfa/*"
      },
      {
        Sid    = "ManageOwnMfaDevice"
        Effect = "Allow"
        Action = [
          "iam:EnableMFADevice",
          "iam:GetMFADevice",
          "iam:GetUser",
          "iam:ListMFADevices",
          "iam:ResyncMFADevice",
        ]
        Resource = "arn:aws:iam::*:user/$${aws:username}"
      },
      {
        Sid    = "ReadOwnSecurityCredentials"
        Effect = "Allow"
        Action = [
          "iam:GetLoginProfile",
          "iam:ListAccessKeys",
          "iam:ListServiceSpecificCredentials",
          "iam:ListSigningCertificates",
          "iam:ListSSHPublicKeys",
        ]
        Resource = "arn:aws:iam::*:user/$${aws:username}"
      },
      {
        Sid      = "DeactivateOwnMfaWithMfaSession"
        Effect   = "Allow"
        Action   = ["iam:DeactivateMFADevice"]
        Resource = "arn:aws:iam::*:user/$${aws:username}"
        Condition = {
          Bool = {
            "aws:MultiFactorAuthPresent" = "true"
          }
        }
      },
    ]
  })
}

resource "aws_iam_openid_connect_provider" "github" {
  count = local.github_oidc_enabled ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.github_oidc_thumbprints
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  count = local.github_oidc_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github[0].arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  count = local.github_oidc_enabled ? 1 : 0

  name               = "${var.name_prefix}-github-actions-role"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role[0].json
}

resource "aws_iam_role_policy_attachment" "github_actions_power_user" {
  count = local.github_oidc_enabled ? 1 : 0

  role       = aws_iam_role.github_actions[0].name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy_attachment" "github_actions_iam_full_access" {
  count = local.github_oidc_enabled ? 1 : 0

  role       = aws_iam_role.github_actions[0].name
  policy_arn = "arn:aws:iam::aws:policy/IAMFullAccess"
}

resource "aws_iam_role_policy" "github_actions_pass_roles" {
  count = local.github_oidc_enabled ? 1 : 0

  name = "${var.name_prefix}-github-actions-pass-roles"
  role = aws_iam_role.github_actions[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.app_server_task.arn,
          aws_iam_role.realtime_server_task.arn,
          aws_iam_role.ai_worker_task.arn,
          aws_iam_role.github_sync_worker_task.arn,
        ]
      }
    ]
  })
}

data "aws_iam_policy_document" "github_actions_terraform_plan_assume_role" {
  count = local.github_oidc_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github[0].arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_owner}/${var.github_repo}:pull_request",
        "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions_terraform_plan" {
  count = local.github_oidc_enabled ? 1 : 0

  name               = "${var.name_prefix}-github-actions-terraform-plan-role"
  assume_role_policy = data.aws_iam_policy_document.github_actions_terraform_plan_assume_role[0].json
}

resource "aws_iam_role_policy" "github_actions_terraform_plan" {
  count = local.github_oidc_enabled ? 1 : 0

  name = "${var.name_prefix}-github-actions-terraform-plan-read"
  role = aws_iam_role.github_actions_terraform_plan[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadTerraformState"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = [
          local.terraform_plan_state_object_arn,
          local.terraform_plan_state_lockfile_object_arn,
        ]
      },
      {
        Sid      = "ListTerraformStatePrefix"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = var.terraform_plan_state_bucket_arn
        Condition = {
          StringLike = {
            "s3:prefix" = [
              var.terraform_plan_state_key,
              "${var.terraform_plan_state_key}*",
            ]
          }
        }
      },
      {
        Sid    = "ManageTerraformPlanLockfile"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = local.terraform_plan_state_lockfile_object_arn
      },
      {
        Sid    = "ReadTerraformManagedResources"
        Effect = "Allow"
        Action = [
          "acm:DescribeCertificate",
          "acm:ListTagsForCertificate",
          "cloudfront:DescribeFunction",
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:GetOriginAccessControl",
          "cloudfront:ListTagsForResource",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:ListTagsForResource",
          "dynamodb:DescribeTable",
          "dynamodb:ListTagsOfResource",
          "ec2:DescribeAddresses",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribeImages",
          "ec2:DescribeInstanceAttribute",
          "ec2:DescribeInstances",
          "ec2:DescribeInternetGateways",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeRouteTables",
          "ec2:DescribeSecurityGroupRules",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSubnets",
          "ec2:DescribeTags",
          "ec2:DescribeVolumes",
          "ec2:DescribeVpcs",
          "ecr:DescribeRepositories",
          "ecr:GetLifecyclePolicy",
          "ecr:ListTagsForResource",
          "ecs:DescribeClusters",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:ListTagsForResource",
          "elasticache:DescribeCacheClusters",
          "elasticache:DescribeCacheSubnetGroups",
          "elasticache:ListTagsForResource",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:DescribeLoadBalancerAttributes",
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:DescribeTags",
          "elasticloadbalancing:DescribeTargetGroupAttributes",
          "elasticloadbalancing:DescribeTargetGroups",
          "iam:GetInstanceProfile",
          "iam:GetOpenIDConnectProvider",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:GetUser",
          "iam:GetUserPolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListAttachedUserPolicies",
          "iam:ListInstanceProfileTags",
          "iam:ListOpenIDConnectProviderTags",
          "iam:ListPolicyTags",
          "iam:ListPolicyVersions",
          "iam:ListRolePolicies",
          "iam:ListRoleTags",
          "iam:ListUserPolicies",
          "iam:ListUserTags",
          "logs:DescribeLogGroups",
          "logs:DescribeMetricFilters",
          "logs:ListTagsLogGroup",
          "logs:ListTagsForResource",
          "rds:DescribeDBInstances",
          "rds:DescribeDBSubnetGroups",
          "rds:ListTagsForResource",
          "route53:GetHostedZone",
          "route53:ListResourceRecordSets",
          "route53:ListTagsForResource",
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListTagsForResource",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ListQueueTags",
          "sts:GetCallerIdentity",
          "tag:GetResources",
        ]
        Resource = "*"
      },
      {
        Sid    = "ReadTerraformManagedS3Configuration"
        Effect = "Allow"
        Action = [
          "s3:GetAccelerateConfiguration",
          "s3:GetBucketAcl",
          "s3:GetBucketCors",
          "s3:GetBucketEncryption",
          "s3:GetBucketLifecycleConfiguration",
          "s3:GetBucketLocation",
          "s3:GetBucketLogging",
          "s3:GetBucketOwnershipControls",
          "s3:GetBucketPolicy",
          "s3:GetBucketPolicyStatus",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketTagging",
          "s3:GetBucketVersioning",
          "s3:GetBucketWebsite",
          "s3:GetReplicationConfiguration",
          "s3:ListBucket",
        ]
        Resource = local.terraform_plan_bucket_arns
      },
    ]
  })
}
