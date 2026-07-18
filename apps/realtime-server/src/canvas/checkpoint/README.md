# Canvas Checkpoint

`state/`에 남은 dirty shape와 tombstone을 App Server `/shapes/batch`로 저장한다.

- 마지막 Shape 변경 후 1분 idle 또는 최초 dirty 후 최대 5분에 checkpoint한다.
- dirty Shape 100개 또는 예상 payload 1MB 도달 시 즉시 checkpoint한다.
- 동일 Shape는 최신 상태 하나만 dirty로 유지하고 100개 batch를 연속 drain한다.
- batch 사이에 event loop를 양보하고 서버 전체 동시 room checkpoint 수를 제한한다.
- 저장 성공 결과의 revision과 content hash를 roomState에 반영한다.
- 분리 가능한 4xx 실패는 operation을 나누어 정상 shape 저장을 계속한다.
- 실패한 operation은 dirty 상태로 남겨 `1s → 2s → 5s → 10s → 30s` backoff로 재시도한다.
- 일반 leave/disconnect는 저장하지 않는다. 마지막 사용자가 나간 뒤 7.5초 동안
  재입장이 없을 때만 drain하고, 성공한 빈 roomState를 정리한다.
- graceful shutdown에서는 모든 room의 남은 dirty operation을 drain한다.

API 계약이나 DB schema를 정의하지 않으며, 기존 Canvas batch 계약의 호출자다.
