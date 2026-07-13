$ErrorActionPreference = "Stop"

$endpoint = $env:SQS_ENDPOINT
if ([string]::IsNullOrWhiteSpace($endpoint)) {
  $endpoint = "http://localhost:4566"
}

$region = $env:AWS_REGION
if ([string]::IsNullOrWhiteSpace($region)) {
  $region = "ap-northeast-2"
}

aws --endpoint-url $endpoint sqs create-queue --queue-name pilo-dev-ai-jobs-dlq --region $region | Out-Null
aws --endpoint-url $endpoint sqs create-queue --queue-name pilo-dev-ai-jobs --region $region | Out-Null
aws --endpoint-url $endpoint sqs create-queue --queue-name pilo-dev-pr-review-analysis-dlq --region $region | Out-Null
aws --endpoint-url $endpoint sqs create-queue --queue-name pilo-dev-pr-review-analysis --region $region | Out-Null
aws --endpoint-url $endpoint sqs create-queue --queue-name pilo-dev-github-webhooks-dlq --region $region | Out-Null
aws --endpoint-url $endpoint sqs create-queue --queue-name pilo-dev-github-sync-jobs-dlq --region $region | Out-Null

function New-GithubQueue {
  param(
    [string]$QueueName,
    [int]$VisibilityTimeout,
    [string]$DlqName
  )

  $dlqUrl = aws --endpoint-url $endpoint sqs get-queue-url --queue-name $DlqName --region $region --query 'QueueUrl' --output text
  $dlqArn = aws --endpoint-url $endpoint sqs get-queue-attributes --queue-url $dlqUrl --attribute-names QueueArn --region $region --query 'Attributes.QueueArn' --output text
  $queueUrl = aws --endpoint-url $endpoint sqs create-queue --queue-name $QueueName --region $region --query 'QueueUrl' --output text
  $redrivePolicy = (@{
    deadLetterTargetArn = $dlqArn
    maxReceiveCount     = "3"
  } | ConvertTo-Json -Compress)
  $attributes = (@{
    VisibilityTimeout = "$VisibilityTimeout"
    RedrivePolicy     = $redrivePolicy
  } | ConvertTo-Json -Compress)

  aws --endpoint-url $endpoint sqs set-queue-attributes --queue-url $queueUrl --attributes $attributes --region $region | Out-Null
}

New-GithubQueue -QueueName "pilo-dev-github-webhooks" -VisibilityTimeout 120 -DlqName "pilo-dev-github-webhooks-dlq"
New-GithubQueue -QueueName "pilo-dev-github-sync-jobs" -VisibilityTimeout 900 -DlqName "pilo-dev-github-sync-jobs-dlq"

Write-Host "Created local SQS queues at $endpoint"
