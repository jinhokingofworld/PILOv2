#!/bin/sh
set -e

awslocal sqs create-queue --queue-name pilo-dev-ai-jobs-dlq >/dev/null
awslocal sqs create-queue --queue-name pilo-dev-ai-jobs >/dev/null
awslocal sqs create-queue --queue-name pilo-dev-github-webhooks-dlq >/dev/null
awslocal sqs create-queue --queue-name pilo-dev-github-webhooks >/dev/null
awslocal sqs create-queue --queue-name pilo-dev-github-sync-jobs-dlq >/dev/null
awslocal sqs create-queue --queue-name pilo-dev-github-sync-jobs >/dev/null
