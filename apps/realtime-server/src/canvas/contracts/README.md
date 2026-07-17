# Canvas Contracts

Canvas realtime 모듈 내부에서 공유하는 room, presence, shape patch, checkpoint와
preview payload 타입을 정의한다.

이 폴더는 타입 계약만 소유한다. payload 런타임 검증은 `socket/`, 상태 변경은
`state/`, 저장은 `checkpoint/`에서 처리한다.
