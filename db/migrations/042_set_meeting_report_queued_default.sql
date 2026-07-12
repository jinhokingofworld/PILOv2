-- 새 enum 값은 추가한 트랜잭션이 커밋된 뒤에 기본값으로 사용한다.

ALTER TABLE meeting_reports
  ALTER COLUMN status SET DEFAULT 'QUEUED';
