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
`/ecs/<환경-prefix>/ai-worker`다. 기본 조사 순서는 `report_id`다.

1. App Server에서 `MeetingReport job event=enqueue_requested`와
   `event=enqueued`를 찾는다. 후자에는 `sqs_message_id`가 포함된다.
2. durable outbox를 사용한 흐름이면 `MeetingReport outbox` 로그에서
   `outbox_id`, claim/delivered/retry 이벤트를 확인한다.
3. AI Worker에서 같은 `report_id`의 `event=received`와 `event=processed`를 찾는다.
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
| `received` / `processed` | AI Worker | SQS 수신 및 processor 결과 |

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
