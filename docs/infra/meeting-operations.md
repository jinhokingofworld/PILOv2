# Meeting 운영 추적

## 목적

Meeting 녹음 종료부터 AI 회의록 처리까지의 전달 경로와 실패 단계를 운영 로그에서
추적한다. API 응답, SQS raw payload, audio object key, OAuth·LiveKit·OpenAI secret은
조사 키로 사용하거나 로그에 기록하지 않는다.

## Correlation 키

| 키 | 의미 | 확인 위치 |
| --- | --- | --- |
| `meeting_id` | 회의 세션 | Meeting API/DB, App Server·AI Worker 로그 |
| `recording_id` | 종료된 녹음 | Meeting API/DB, App Server·AI Worker 로그 |
| `report_id` | MeetingReport 처리 단위 | App Server·AI Worker 로그의 기본 조사 키 |
| `outbox_id` | durable outbox job correlation ID | App Server outbox 로그/`meeting_report_outbox` |
| `sqs_message_id` | SQS broker 전달 ID | enqueue 성공 로그와 AI Worker 수신 로그 |

`outbox_id`는 재발행돼도 같은 durable intent를 가리키며, `sqs_message_id`는 각 SQS
전달마다 달라질 수 있다. 둘을 같은 ID로 취급하지 않는다.

## 로그 흐름

CloudWatch log group은 ECS service 기준 `/ecs/<환경-prefix>/app-server`와
`/ecs/<환경-prefix>/meeting-worker`다. 기본 조사 순서는 `report_id`다. Agent와
PR Review job은 이 Worker가 아닌 각각의 전용 queue/Worker에서 처리한다.

1. App Server에서 `MeetingReport job event=enqueue_requested`와
   `event=enqueued`를 찾는다. 후자에는 `sqs_message_id`가 포함된다.
2. durable outbox를 사용한 흐름이면 `MeetingReport outbox` 로그에서
   `outbox_id`, claim/delivered/retry 이벤트를 확인한다.
3. Meeting Worker에서 같은 `report_id`의 `event=received`와 `event=processed`를 찾는다.
   `sqs_message_id`와 `receive_count`로 해당 broker 전달을 확인한다.
4. 최종 상태는 MeetingReport의 `COMPLETED` 또는 `FAILED`를 기준으로 확인한다.

| 이벤트 | 위치 | 의미 |
| --- | --- | --- |
| `enqueue_requested` | App Server | SQS 발행 시도 시작 |
| `enqueued` | App Server | SQS가 message를 수락했고 `sqs_message_id`가 생성됨 |
| `enqueue_failed` | App Server | SQS 발행 실패. outbox가 있으면 재발행 대상 |
| `fast_path_delivered` / `fast_path_pending` | App Server | 요청 직후 발행의 delivered 기록 또는 pending 보존 |
| `claimed` / `delivered` | App Server | dispatcher outbox claim 및 SQS 발행 후 delivered 기록 |
| `retry_scheduled` / `retry_exhausted` | App Server | backoff 재시도 예정 또는 한도 소진 |
| `stale_report_failed` | App Server | Worker advisory lock이 없는 오래된 처리 건을 실패 처리 |
| `received` / `processed` | Meeting Worker | SQS 수신 및 processor 결과 |

## 실패 단계 판단

- `failure_step=STT`: recording 상태·audio 접근/크기·STT 변환·outbox enqueue 재시도
  소진·stale recovery 실패다.
- `failure_step=LLM`: transcript 이후 회의록 생성 실패다.
- `failure_step=none`: 정상 완료, 중복 처리, 재시도 가능한 infrastructure failure처럼
  terminal failure 단계가 확정되지 않은 결과다.

outbox가 `pending` 또는 lease가 만료된 `publishing`이면 App Server dispatcher가
재발행한다. `failed`면 재시도 한도가 소진된 상태다. `delivered`인데 Report가
`PROCESSING`이면 AI Worker 로그와 advisory lock 보유 여부를 먼저 확인한다. stale
recovery는 Worker lock을 보유한 Report를 실패 처리하지 않는다.

## Activity snapshot 조사

`meeting_report_activity_evidence`는 `report_id` 기준으로 저장된 안전한 Activity
projection이며, `meeting_report_activity_evidence_references`는 그 Activity가 어느
MeetingReport 산출물(`summary`, `discussion`, `decision`, `action_item`)을 뒷받침했는지
연결한다. 두 table 모두 raw `activity_logs.metadata.data`를 저장하지 않는다.

- `report_id`, `recording_id`와 snapshot `activity_log_id`로 생성 건을 상관한다. 원본
  Activity Log를 조사해야 할 때도 summary와 action만 사용하고 raw metadata를 운영 로그에
  복사하지 않는다.
- snapshot query가 실패하거나 선택 가능한 row가 없으면 Worker는 transcript-only로 완료한다.
  `MeetingReport activity snapshot unavailable` warning과 동일 `report_id`를 확인한다.
- 재생성은 이미 저장된 snapshot을 다시 LLM context로 사용하고, 완료 transaction에서
  snapshot과 그 references를 함께 replace한다. 따라서 regenerate 결과가 현재 Activity Log의
  후속 변경으로 달라지는지부터 확인할 필요는 없다.

## 전용 queue 운영

MeetingReport는 `${prefix}-meeting-jobs`만 사용한다. queue visibility timeout은
`900`초이고, infrastructure failure로 메시지를 삭제하지 못한 경우 최대 3회 수신 뒤
`${prefix}-meeting-jobs-dlq`로 이동한다. DLQ 메시지는 원인을 수정하기 전 재전송하지
않는다.

CloudWatch에서는 다음 alarm을 확인한다.

- `${prefix}-meeting-jobs-oldest-age`: 가장 오래된 메시지 600초 이상
- `${prefix}-meeting-jobs-backlog`: visible 메시지 10개 이상
- `${prefix}-meeting-jobs-dlq-backlog`: DLQ visible 메시지 1개 이상
- `${prefix}-meeting-worker-running-tasks`: 2분 연속 running task 0개

## 배포·롤백 순서

1. 첫 Terraform apply는 `legacy_meeting_drain_enabled=true`로 수행한다. 이 단계에서
   shared `ai-worker`는 기존 `ai-jobs`의 Agent/Canvas와 MeetingReport를 모두 계속
   처리하고, `meeting-worker` ECS service·전용 queue/DLQ·alarm을 생성한다. shared
   Worker에서 Meeting processor를 제거한 상태로 이 단계를 적용하면 안 된다.
2. `meeting-worker`의 desired/running count가 `1/1`인지 확인하고, task definition에
   `SQS_MEETING_JOBS_QUEUE_URL`만 있으며
   `SQS_AI_JOBS_QUEUE_URL`, `SQS_PR_REVIEW_ANALYSIS_QUEUE_URL`가 없는지 확인한다.
3. App Server를 배포해 MeetingReport publisher를 전용 queue로 전환한다. 전환 직후
   App Server enqueue log와 Meeting Worker receive log의 `sqs_message_id`를 대조한다.
4. 기존 `ai-jobs`의 모든 MeetingReport 메시지가 shared Worker에서 처리된 것을
   `event=received`/`event=processed` 로그와 queue in-flight/visible count로 확인한다.
   publisher 전환 뒤 새 `meeting_report` enqueue가 기존 queue에 없고, 최소 한 번의
   visibility timeout 동안 legacy MeetingReport 수신이 없을 때만 drain 완료로 본다.
5. drain 완료 후에만 `legacy_meeting_drain_enabled=false`로 Terraform apply를 수행한다.
   이 apply가 shared Worker의 Meeting processor 설정과 callback secret을 제거하는
   최종 격리 단계다.

rollback은 publisher를 먼저 되돌리지 않는다. 먼저
`legacy_meeting_drain_enabled=true`로 Terraform apply하여 shared Worker의
Meeting processor·recording bucket·callback token을 복구하고 task가 안정화된 것을
확인한다. 그 다음에만 App Server publisher를 기존 shared queue로 되돌린다. 새
`meeting-jobs`의 in-flight/visible 메시지는 유실시키지 않고 Meeting Worker가 drain한
뒤 service를 중지한다.
