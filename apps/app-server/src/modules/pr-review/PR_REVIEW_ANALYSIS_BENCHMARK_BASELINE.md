# PR Review 분석 아키텍처 Benchmark 기준선

이 문서는 PR Review 기능을 완성한 뒤 App Server 직접 실행 구조와 SQS 기반 전용 Worker
구조를 같은 조건에서 비교하기 위한 재현 기준을 기록한다. 비밀값과 실제 사용자 데이터는
기록하지 않는다.

## 기준 시점

- 기록일: 2026-07-11 (KST)
- 저장소: `Developer-EJ/PILO`
- 직접 실행 기준 커밋:
  `9d1c6469de67537484a7618373e780b2a0fe9d35`
- 비동기 전환 시작 커밋:
  `c81b98b2bd128edd0800eb6b74ace43fdc978d6e`
- 전용 Worker 배포 리소스 추가 직전 커밋:
  `922f57e334729c19acafd6d128ff3f75fde7834d`
- 전용 Worker 배포 리소스 최초 커밋:
  `8b0565e04d1e8a324f0dcd70713ea819888b2e1b`

직접 실행 기준 커밋에서는 `POST /review-sessions` 처리 중 GitHub PR 상세, 변경 파일,
conflict 상태를 조회한 뒤 `analysisService.analyzePullRequest()`를 `await`한다. 분석과
그래프 저장이 끝난 후에 Review Session 응답을 반환하므로 PR Review 분석 전용 SQS나
전용 Worker를 사용하지 않는다.

다음 커밋인 `c81b98b2...`부터 비동기 분석 Job schema가 추가되므로, 직접 실행 비교군은
반드시 `9d1c6469...`의 실행 흐름을 기준으로 재현한다.

## 저장소에 선언된 dev 환경

아래 값은 직접 실행 기준 커밋의 Terraform과 App Server 코드에 선언된 값이다.

| 항목 | 기준값 |
| --- | --- |
| AWS region | `ap-northeast-2` |
| App Server ECS task 수 | `1` |
| App Server CPU | `256` CPU units |
| App Server memory | `512` MiB |
| App Server port | `3000` |
| ECS network | public subnet, public IP 사용, NAT Gateway 미사용 |
| Node.js image | `node:22-alpine` |
| 실행 명령 | `node dist/main.js` |
| dev PR Review model | `gpt-5.5` |
| dev OpenAI timeout | `45000` ms |
| 코드 기본 model | `gpt-5.1-mini` |
| 코드 기본 timeout | `15000` ms |
| PR body 입력 제한 | `4000`자 |
| 파일별 patch 입력 제한 | `4000`자 |
| 전체 patch 입력 제한 | `32000`자 |

Terraform의 dev 환경에서는 모델과 timeout을 주입하므로 AWS dev 비교에서는
`gpt-5.5`, `45000` ms가 기준이다. 코드 기본값은 해당 환경변수가 없는 로컬 실행에만
적용된다.

## 재현할 때 추가로 고정할 값

현재 Terraform의 App Server image tag는 mutable한 `latest`다. 따라서 실제 benchmark
배포를 만들 때는 다음 값을 실행 기록에 추가해야 한다.

- App Server와 Worker의 Docker image digest
- ECS task definition revision과 실제 desired/running task 수
- benchmark 전용 Terraform state와 stack 이름
- DB instance와 connection pool 설정
- 사용한 PR fixture ID 또는 익명화된 입력 snapshot hash
- 모델, prompt/schema 버전, timeout, retry 설정
- 동시 요청 수, 반복 횟수, warm-up 횟수
- 실제 OpenAI/GitHub 호출 또는 fixed-delay mock 사용 여부와 고정 지연값

API key, OAuth token, internal handoff token, DB password, 실제 PR 코드 원문은 문서나
benchmark 결과에 저장하지 않는다.

## 비교 원칙

기능이 안정화된 뒤 같은 분석 로직과 입력을 아래 두 실행 모드로 비교한다.

1. App Server 직접 실행: 요청 안에서 분석과 저장이 끝날 때까지 기다린다.
2. 전용 Worker 실행: App Server가 durable Job을 저장하고 SQS를 통해 Worker가 처리한다.

두 모드에서 fixture, 모델, prompt/schema, 입력 제한, DB 조건과 부하 패턴을 같게 유지한다.
인프라 효과는 fixed-delay mock으로 먼저 측정하고, 실제 외부 API를 사용하는 소규모 E2E는
별도로 수행한다.

최소 측정값은 API 응답시간 p50/p95, 작업 완료시간 p50/p95, 처리량, 실패율, 작업 유실률,
중복 side effect, 장애 복구시간, queue depth, oldest message age, drain time, 다른 도메인
API의 p95 변화다.

## 현재 기록의 한계

이 문서는 저장소에 선언된 설정을 기준으로 한다. 2026-07-11 당시 AWS에서 실행 중이던
task definition revision, image digest, 콘솔 수동 override까지 조회해 보존한 실측 snapshot은
아니다. 정식 benchmark 전에는 위의 추가 고정값을 별도 실행 manifest로 남겨야 한다.
