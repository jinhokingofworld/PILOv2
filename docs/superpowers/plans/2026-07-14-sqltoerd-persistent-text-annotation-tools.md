# SQLtoERD 영속 텍스트 annotation과 도구 배치 개선 구현 계획

> **실행 방식:** 사용자 요청에 따라 이 작업공간에서 순차적으로 구현·검증한다.

**목표:** SQLtoERD의 기존 빈 캔버스 더블클릭 텍스트 경험을 저장 가능한 annotation으로 전환하고, 메모·프레임·텍스트 도구를 클릭 후 배치하는 하단 중앙 도구 모음으로 정리한다.

**구현 방향:** Canvas 전체를 이식하지 않는다. Canvas의 one-shot tool과 색상 적용 규칙을 SQLtoERD 도메인 상태(`layoutJson.annotations`)에 맞게 최소 적용한다.

## 작업 단계

1. `layoutJson.annotations.texts`의 frontend 타입, patch 명령, 최신 상태 병합 로직을 추가한다.
2. app-server validation과 API 계약 문서에 texts, links·notes·frames·texts 전체 ID 고유성, 한도와 필드를 반영한다.
3. SQLtoERD 전용 text shape와 annotation sync를 추가해 생성·편집·이동·색상·삭제·복원을 저장한다.
4. 도구 상태를 SQLtoERD 내부에 두고 메모·프레임·텍스트 모두 클릭 후 한 번 배치하고 선택 도구로 복귀하게 한다. 빈 캔버스 더블클릭도 같은 텍스트 생성 경로를 사용한다.
5. 도구 모음을 하단 중앙으로 이동하고, 선택/드래그·색상·프레임 잠금 이벤트의 캔버스 충돌을 분리한다.
6. `scripts/sql-erd/test.mjs`와 도메인 validation 테스트를 확장하고, format·typecheck·build·도메인 테스트로 검증한다.
