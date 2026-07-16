# Canvas Checkpoint

`state/`에 남은 dirty shape와 tombstone을 App Server `/shapes/batch`로 저장한다.

- room별 checkpoint timer와 실행 중인 요청을 관리한다.
- 저장 성공 결과의 revision과 content hash를 roomState에 반영한다.
- 분리 가능한 4xx 실패는 operation을 나누어 정상 shape 저장을 계속한다.
- 실패한 operation은 dirty 상태로 남겨 다음 checkpoint에서 재시도한다.
- join, leave, disconnect와 server shutdown에서 즉시 flush할 수 있다.

API 계약이나 DB schema를 정의하지 않으며, 기존 Canvas batch 계약의 호출자다.
