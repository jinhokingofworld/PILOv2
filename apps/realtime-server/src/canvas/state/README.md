# Canvas Room State

classic Canvas room별 shape cache, delete tombstone, dirty shape, checkpoint
metadata와 undo/redo history를 관리한다.

DB viewport hydrate는 비어 있는 Shape만 채우며 같은 ID의 roomState와 delete
tombstone을 덮지 않는다. 저장된 delete tombstone도 일정 시간 유지해 요청 중이던
오래된 DB 응답이 Shape를 되살리지 못하게 한다.

- `canvas-room-state.service.ts`: 모든 roomState Map의 단일 소유자
- `canvas-loaded-region.ts`: viewport loaded region 생성·병합 계산
- `canvas-shape-record.ts`: raw shape 복제, 비교와 저장 metadata 변환

helper 파일은 순수 계산만 수행한다. 새로운 service 인스턴스나 별도 Map을 만들어
상태를 분산시키지 않는다.
