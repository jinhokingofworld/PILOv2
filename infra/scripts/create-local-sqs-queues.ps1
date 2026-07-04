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
aws --endpoint-url $endpoint sqs create-queue --queue-name pilo-dev-github-webhooks-dlq --region $region | Out-Null
aws --endpoint-url $endpoint sqs create-queue --queue-name pilo-dev-github-webhooks --region $region | Out-Null

Write-Host "Created local SQS queues at $endpoint"
