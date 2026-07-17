# Canvas Shape Preview

사용자가 shape를 이동하거나 크기를 바꾸거나 삭제하는 동안의 임시 화면 상태를
관리한다.

preview는 확정된 shape patch가 아니며 roomState history나 checkpoint 대상이
아니다. 확정 patch가 도착하거나 socket이 나가면 관련 preview를 정리한다.
Redis가 연결된 환경에서는 여러 realtime-server 인스턴스가 같은 임시 상태를
조회할 수 있도록 TTL과 함께 저장한다.
