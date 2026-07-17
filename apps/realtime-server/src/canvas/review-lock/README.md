# Canvas Review Lock

PR Review conflict draft에서 사용하는 짧은 TTL의 shape lock을 관리한다.

이 lock은 classic Canvas의 동시 편집 차단 정책이 아니다. classic Canvas는 같은
shape에 대한 여러 사용자의 변경을 모두 수신하고 서버 수신 순서대로 history와
최종 상태에 반영한다.
