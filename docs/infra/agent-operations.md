# Agent queue 운영

Agent job은 `agent-jobs`와 `agent-worker`에서만 처리한다. 전용 queue의 visibility
timeout은 900초이고 worker는 한 번에 하나의 SQS message만 받아 처리한다. retryable
planner infrastructure failure는 세 번째 receive에서 Agent run을 safe failed로
terminalize한 뒤 source message를 삭제한다. 이 terminalization 자체가 실패하거나 Agent
processor가 없어서 삭제하지 못한 message만 재시도 뒤 `agent-jobs-dlq`로 보존한다.

## Cutover

1. `agent-worker`를 desired count 1로 배포하고 `LEGACY_AGENT_DRAIN_ENABLED=true`를 유지한다.
2. App Server에 `SQS_AGENT_JOBS_QUEUE_URL`이 주입된 것을 확인한 뒤 publisher를 전용 queue로 전환한다.
3. shared `ai-jobs`의 기존 Agent message가 0이고 성공/실패 handoff가 정상인지 로그와 queue metric으로 확인한다.
4. `legacy_agent_drain_enabled=false`로 적용해 shared worker에서 Agent processor와 handoff token을 제거한다.

CloudWatch에서 `agent-jobs` backlog, oldest message age, DLQ backlog, Agent worker running task count를
모니터링한다. DLQ backlog는 즉시 조사하고 재처리한다.

## Rollback

publisher를 먼저 되돌리지 않는다. shared worker에 `legacy_agent_drain_enabled=true`와 handoff token을
먼저 복구해 Agent processor가 정상 동작하는 것을 확인한 뒤 publisher를 기존 `ai-jobs`로 되돌린다.
Agent processor가 없는 worker에 잘못 들어온 Agent message는 삭제하지 않고 retry/DLQ로 보존한다.
