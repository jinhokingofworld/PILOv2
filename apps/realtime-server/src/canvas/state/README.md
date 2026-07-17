# Canvas Room State

classic Canvas room별 shape cache, delete tombstone, dirty shape, checkpoint
metadata와 undo/redo history를 관리한다.

- `canvas-room-state.service.ts`: 모든 roomState Map의 단일 소유자
- `canvas-loaded-region.ts`: viewport loaded region 생성·병합 계산
- `canvas-shape-record.ts`: raw shape 복제, 비교와 저장 metadata 변환

helper 파일은 순수 계산만 수행한다. 새로운 service 인스턴스나 별도 Map을 만들어
상태를 분산시키지 않는다.
