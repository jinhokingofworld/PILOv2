# Canvas Shape

- `CanvasShapeQueryService`: viewport와 shape 상세 조회
- `CanvasShapeCommandService`: create, update, delete와 batch transaction
- validation, mapper, content hash

Shape command는 revision, idempotency, operation log와 activity log를 같은
transaction 경계에서 처리한다.
