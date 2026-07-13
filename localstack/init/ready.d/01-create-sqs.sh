#!/bin/sh
set -e

awslocal sqs create-queue --queue-name pilo-dev-ai-jobs-dlq >/dev/null
awslocal sqs create-queue --queue-name pilo-dev-ai-jobs >/dev/null
awslocal sqs create-queue --queue-name pilo-dev-github-webhooks-dlq >/dev/null
awslocal sqs create-queue --queue-name pilo-dev-github-sync-jobs-dlq >/dev/null

create_github_queue() {
  queue_name="$1"
  visibility_timeout="$2"
  dlq_name="$3"
  queue_url=$(awslocal sqs create-queue --queue-name "$queue_name" --query 'QueueUrl' --output text)
  dlq_url=$(awslocal sqs get-queue-url --queue-name "$dlq_name" --query 'QueueUrl' --output text)
  dlq_arn=$(awslocal sqs get-queue-attributes --queue-url "$dlq_url" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

  awslocal sqs set-queue-attributes \
    --queue-url "$queue_url" \
    --attributes "{\"VisibilityTimeout\":\"$visibility_timeout\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$dlq_arn\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" \
    >/dev/null
}

create_github_queue "pilo-dev-github-webhooks" "120" "pilo-dev-github-webhooks-dlq"
create_github_queue "pilo-dev-github-sync-jobs" "900" "pilo-dev-github-sync-jobs-dlq"
