import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shellSetupScript = path.join(repoRoot, 'localstack/init/ready.d/01-create-sqs.sh');
const powershellSetupScript = path.join(repoRoot, 'infra/scripts/create-local-sqs-queues.ps1');
const operationsRunbook = await readFile(path.join(repoRoot, 'docs/infra/github-sync-operations.md'), 'utf8');
const deployChecklist = await readFile(path.join(repoRoot, 'docs/infra/deploy-checklist.md'), 'utf8');
const architecture = await readFile(path.join(repoRoot, 'docs/infra/dev-architecture.md'), 'utf8');
const observabilityModule = await readFile(path.join(repoRoot, 'infra/modules/github-sync-observability/main.tf'), 'utf8');
const localStackWorkflow = await readFile(path.join(repoRoot, '.github/workflows/infra-localstack-integration.yml'), 'utf8');
const powershellCommand = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

assert.match(operationsRunbook, /RUN_LOCALSTACK_INTEGRATION=1/);
assert.match(operationsRunbook, /Docker/);
assert.match(operationsRunbook, /PowerShell/);
assert.match(operationsRunbook, /Infra LocalStack Integration/);
assert.doesNotMatch(operationsRunbook, /intentionally not wired into a common test runner or CI/);
assert.match(deployChecklist, /AWS_TERRAFORM_PLAN_ROLE_ARN/);
assert.match(deployChecklist, /동일 저장소 PR/);
assert.match(architecture, /AWS_TERRAFORM_PLAN_ROLE_ARN/);
assert.match(architecture, /동일 저장소 PR/);
assert.match(architecture, /pilo-dev-github-sync-jobs/);
assert.match(architecture, /pilo-dev-github-sync-jobs-dlq/);
assert.match(localStackWorkflow, /runs-on:\s*ubuntu-latest/);
assert.match(localStackWorkflow, /RUN_LOCALSTACK_INTEGRATION:\s*"1"/);
assert.match(localStackWorkflow, /docker version/);
assert.match(localStackWorkflow, /\.Server\.OsType/);
assert.match(localStackWorkflow, /command -v aws/);
assert.match(localStackWorkflow, /command -v pwsh/);

for (const [alarm, queueName, threshold] of [
  ['webhook_warning', 'github-webhooks', '60'],
  ['webhook_critical', 'github-webhooks', '300'],
  ['sync_jobs_warning', 'github-sync-jobs', '600'],
  ['sync_jobs_critical', 'github-sync-jobs', '1800'],
  ['webhook_warning', 'github-webhooks', '20'],
  ['webhook_critical', 'github-webhooks', '100'],
  ['sync_jobs_warning', 'github-sync-jobs', '10'],
  ['sync_jobs_critical', 'github-sync-jobs', '50'],
  ['webhook_warning', 'github-webhooks-dlq', '1'],
  ['webhook_critical', 'github-webhooks-dlq', '10'],
  ['sync_jobs_warning', 'github-sync-jobs-dlq', '1'],
  ['sync_jobs_critical', 'github-sync-jobs-dlq', '10'],
]) {
  assert.match(observabilityModule, new RegExp(`${alarm}\\s*=\\s*\\{\\s*queue_name\\s*=\\s*\"\\$\\{var.name_prefix\\}-${queueName}\"\\s*threshold\\s*=\\s*${threshold}`, 's'));
}

for (const metricName of ['ApproximateAgeOfOldestMessage', 'ApproximateNumberOfMessagesVisible']) {
  assert.match(observabilityModule, new RegExp(`metric_name\\s*=\\s*\"${metricName}\"\\s*namespace\\s*=\\s*\"AWS/SQS\"\\s*period\\s*=\\s*60.*treat_missing_data\\s*=\\s*\"notBreaching\"\\s*dimensions\\s*=\\s*\\{\\s*QueueName\\s*=\\s*each.value.queue_name`, 's'));
}

assert.match(observabilityModule, /worker_running_task_alarms\s*=\s*\{\s*warning\s*=\s*\{\s*evaluation_periods\s*=\s*2\s*\}\s*critical\s*=\s*\{\s*evaluation_periods\s*=\s*5/s);
assert.match(observabilityModule, /metric_name\s*=\s*"RunningTaskCount"\s*namespace\s*=\s*"ECS\/ContainerInsights"\s*period\s*=\s*60.*threshold\s*=\s*1\s*treat_missing_data\s*=\s*"breaching".*ClusterName\s*=\s*local.ecs_cluster_name\s*ServiceName\s*=\s*local.github_sync_worker_service_name/s);

for (const [key, metricName, statistic, comparisonOperator, threshold] of [
  ['retry_warning', 'RetryCount', 'Sum', 'GreaterThanOrEqualToThreshold', '5'],
  ['retry_critical', 'RetryCount', 'Sum', 'GreaterThanOrEqualToThreshold', '20'],
  ['terminal_failure_warning', 'TerminalFailureCount', 'Sum', 'GreaterThanOrEqualToThreshold', '1'],
  ['terminal_failure_critical', 'TerminalFailureCount', 'Sum', 'GreaterThanOrEqualToThreshold', '5'],
  ['rate_limit_remaining_warning', 'RateLimitRemaining', 'Minimum', 'LessThanOrEqualToThreshold', '100'],
  ['rate_limit_remaining_critical', 'RateLimitRemaining', 'Minimum', 'LessThanOrEqualToThreshold', '0'],
]) {
  assert.match(observabilityModule, new RegExp(`${key}\\s*=\\s*\\{\\s*metric_name\\s*=\\s*\"${metricName}\"\\s*statistic\\s*=\\s*\"${statistic}\"\\s*comparison_operator\\s*=\\s*\"${comparisonOperator}\"\\s*threshold\\s*=\\s*${threshold}`, 's'));
}

assert.match(observabilityModule, /resource "aws_cloudwatch_metric_alarm" "operation" \{\s*for_each\s*=\s*local.operation_alarms.*comparison_operator\s*=\s*each.value.comparison_operator\s*evaluation_periods\s*=\s*1\s*metric_name\s*=\s*each.value.metric_name\s*namespace\s*=\s*local.metric_namespace\s*period\s*=\s*300\s*statistic\s*=\s*each.value.statistic\s*threshold\s*=\s*each.value.threshold\s*treat_missing_data\s*=\s*"notBreaching"/s);
assert.doesNotMatch(observabilityModule, /alarm_actions/);

if (process.env.RUN_LOCALSTACK_INTEGRATION !== '1') {
  console.log('Skipped LocalStack integration test. Set RUN_LOCALSTACK_INTEGRATION=1 to run it manually.');
  process.exit(0);
}

try {
  await run('aws', ['--version']);
  await run(powershellCommand, ['-NoProfile', '-Command', 'Get-Command aws -ErrorAction Stop | Out-Null']);
} catch {
  throw new Error(`AWS CLI and ${powershellCommand} are required to run the PowerShell setup path.`);
}

const region = 'ap-northeast-2';
const image = 'localstack/localstack:3';
const containers = [];

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, { encoding: 'utf8', ...options });
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${error.stderr || error.message}`);
  }
}

async function startLocalStack(label) {
  const name = `pilo-824-${label}-${process.pid}-${Date.now()}`.toLowerCase();
  containers.push(name);
  await run('docker', [
    'run', '--rm', '-d', '--name', name,
    '-p', '127.0.0.1::4566',
    '-e', 'SERVICES=sqs',
    '-e', `AWS_DEFAULT_REGION=${region}`,
    image,
  ]);

  const { stdout } = await run('docker', ['port', name, '4566/tcp']);
  const port = stdout.trim().match(/:(\d+)$/)?.[1];
  assert.ok(port, `Unable to determine LocalStack port from: ${stdout}`);
  const endpoint = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await awsCli(name, ['sqs', 'list-queues']);
      return { name, endpoint };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`LocalStack ${name} did not become ready.`);
}

async function awsCli(containerName, args) {
  const { stdout } = await run('docker', [
    'exec', containerName,
    'awslocal',
    ...args,
  ]);
  return stdout;
}

async function assertGithubQueues(containerName) {
  for (const [queueName, visibilityTimeout, dlqName] of [
    ['pilo-dev-github-webhooks', '120', 'pilo-dev-github-webhooks-dlq'],
    ['pilo-dev-github-sync-jobs', '900', 'pilo-dev-github-sync-jobs-dlq'],
  ]) {
    const queueUrl = (await awsCli(containerName, ['sqs', 'get-queue-url', '--queue-name', queueName, '--query', 'QueueUrl', '--output', 'text'])).trim();
    const attributesResponse = await awsCli(containerName, ['sqs', 'get-queue-attributes', '--queue-url', queueUrl, '--attribute-names', 'VisibilityTimeout', 'RedrivePolicy']);
    assert.ok(attributesResponse, `${queueName} attributes response`);
    const attributes = JSON.parse(attributesResponse).Attributes;
    const redrivePolicy = JSON.parse(attributes.RedrivePolicy);

    assert.equal(attributes.VisibilityTimeout, visibilityTimeout, `${queueName} visibility timeout`);
    assert.equal(redrivePolicy.maxReceiveCount, '3', `${queueName} max receive count`);
    assert.match(redrivePolicy.deadLetterTargetArn, new RegExp(`:${dlqName}$`), `${queueName} DLQ target`);
  }
}

async function precreateGithubSourceQueues(containerName) {
  for (const queueName of [
    'pilo-dev-github-webhooks',
    'pilo-dev-github-sync-jobs',
  ]) {
    await awsCli(containerName, ['sqs', 'create-queue', '--queue-name', queueName]);
  }
}

async function runShellSetup() {
  const localstack = await startLocalStack('shell');
  await precreateGithubSourceQueues(localstack.name);
  await run('docker', ['cp', shellSetupScript, `${localstack.name}:/tmp/01-create-sqs.sh`]);
  await run('docker', ['exec', localstack.name, 'sh', '/tmp/01-create-sqs.sh']);
  await assertGithubQueues(localstack.name);
}

async function runPowerShellSetup() {
  const localstack = await startLocalStack('powershell');
  await precreateGithubSourceQueues(localstack.name);
  await run(powershellCommand, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', powershellSetupScript,
  ], {
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_REGION: region,
      SQS_ENDPOINT: localstack.endpoint,
    },
  });
  await assertGithubQueues(localstack.name);
}

try {
  await runShellSetup();
  await runPowerShellSetup();
  console.log('LocalStack GitHub queue configuration is verified for shell and PowerShell setup paths.');
} finally {
  await Promise.all(containers.map((name) => run('docker', ['rm', '-f', name]).catch(() => {})));
}
