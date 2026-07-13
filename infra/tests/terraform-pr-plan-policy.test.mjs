import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [workflow, iamModule, iamOutputs, devMain, devOutputs, deployChecklist, architecture] = await Promise.all([
  readFile(path.join(repoRoot, '.github/workflows/terraform-validate.yml'), 'utf8'),
  readFile(path.join(repoRoot, 'infra/modules/iam/main.tf'), 'utf8'),
  readFile(path.join(repoRoot, 'infra/modules/iam/outputs.tf'), 'utf8'),
  readFile(path.join(repoRoot, 'infra/envs/dev/main.tf'), 'utf8'),
  readFile(path.join(repoRoot, 'infra/envs/dev/outputs.tf'), 'utf8'),
  readFile(path.join(repoRoot, 'docs/infra/deploy-checklist.md'), 'utf8'),
  readFile(path.join(repoRoot, 'docs/infra/dev-architecture.md'), 'utf8'),
]);

const planJobStart = workflow.indexOf('\n  plan:');
assert.notEqual(planJobStart, -1, 'Terraform plan job must exist');
const planJob = workflow.slice(planJobStart);

assert.match(workflow, /Verify Terraform PR plan policy\s*\n\s*run: node infra\/tests\/terraform-pr-plan-policy\.test\.mjs/);
assert.match(planJob, /vars\.AWS_TERRAFORM_PLAN_ROLE_ARN/);
assert.match(planJob, /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/);
assert.match(planJob, /github\.event_name\s*==\s*'workflow_dispatch'/);
assert.match(planJob, /github\.ref\s*==\s*'refs\/heads\/main'/);
assert.match(planJob, /role-to-assume:\s*\$\{\{ vars\.AWS_TERRAFORM_PLAN_ROLE_ARN \}\}/);
assert.doesNotMatch(planJob, /AWS_GITHUB_ACTIONS_ROLE_ARN/);
assert.match(planJob, /terraform plan -input=false/);

const deploymentTrustStart = iamModule.indexOf('data "aws_iam_policy_document" "github_actions_assume_role"');
const deploymentTrustEnd = iamModule.indexOf('resource "aws_iam_role" "github_actions"', deploymentTrustStart);
assert.notEqual(deploymentTrustStart, -1, 'Existing deployment trust policy must remain');
assert.notEqual(deploymentTrustEnd, -1, 'Existing deployment role must remain');
const deploymentTrust = iamModule.slice(deploymentTrustStart, deploymentTrustEnd);
assert.match(deploymentTrust, /repo:\$\{var\.github_owner\}\/\$\{var\.github_repo\}:ref:refs\/heads\/main/);
assert.doesNotMatch(deploymentTrust, /:pull_request/);

const planTrustStart = iamModule.indexOf('data "aws_iam_policy_document" "github_actions_terraform_plan_assume_role"');
const planPolicyStart = iamModule.indexOf('resource "aws_iam_role_policy" "github_actions_terraform_plan"');
assert.notEqual(planTrustStart, -1, 'Dedicated Terraform plan trust policy must exist');
assert.notEqual(planPolicyStart, -1, 'Dedicated Terraform plan permission policy must exist');
const planTrust = iamModule.slice(planTrustStart, planPolicyStart);
const planPolicy = iamModule.slice(planPolicyStart);

assert.match(planTrust, /StringEquals/);
assert.match(planTrust, /repo:\$\{var\.github_owner\}\/\$\{var\.github_repo\}:pull_request/);
assert.match(planTrust, /repo:\$\{var\.github_owner\}\/\$\{var\.github_repo\}:ref:refs\/heads\/main/);
assert.match(planPolicy, /s3:GetObject/);
assert.match(planPolicy, /s3:PutObject/);
assert.match(planPolicy, /s3:DeleteObject/);
assert.match(planPolicy, /Resource = local\.terraform_plan_state_lockfile_object_arn/);
assert.match(planPolicy, /s3:GetLifecycleConfiguration/);
assert.doesNotMatch(planPolicy, /s3:GetBucketLifecycleConfiguration/);
assert.match(planPolicy, /s3:GetEncryptionConfiguration/);
assert.doesNotMatch(planPolicy, /s3:GetBucketEncryption/);
assert.match(planPolicy, /cloudfront:GetFunction/);
assert.match(planPolicy, /dynamodb:DescribeContinuousBackups/);
assert.match(planPolicy, /dynamodb:DescribeTimeToLive/);
assert.match(planPolicy, /ec2:DescribeVpcAttribute/);
assert.match(planPolicy, /secretsmanager:DescribeSecret/);
assert.match(planPolicy, /secretsmanager:GetResourcePolicy/);
assert.doesNotMatch(planPolicy, /secretsmanager:GetSecretValue/);
assert.doesNotMatch(planPolicy, /PowerUserAccess|IAMFullAccess/);
assert.doesNotMatch(planPolicy, /iam:(Create|Put|Delete|Attach|Detach|Pass)/);

assert.match(iamOutputs, /output "github_actions_terraform_plan_role_arn"/);
assert.match(devMain, /terraform_plan_state_bucket_arn/);
assert.match(devMain, /terraform_plan_state_key\s*=\s*"infra\/dev\/terraform\.tfstate"/);
assert.match(devOutputs, /output "terraform_plan_role_arn"/);
assert.match(deployChecklist, /AWS_TERRAFORM_PLAN_ROLE_ARN/);
assert.match(deployChecklist, /외부 fork PR/);
assert.match(architecture, /AWS_TERRAFORM_PLAN_ROLE_ARN/);

console.log('Terraform PR plan IAM and workflow policy is verified.');
