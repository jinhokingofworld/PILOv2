# Canvas Operation

Operation catch-up 조회, Canvas activity log 생성과 Redis publish를 소유한다.

Redis publish는 DB source of truth를 대신하지 않으며 transaction 완료 뒤 실행한다.
