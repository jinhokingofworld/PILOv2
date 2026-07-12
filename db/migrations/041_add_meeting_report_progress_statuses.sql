-- MeetingReport 생성 진행 단계를 사용자에게 안전하게 노출한다.
-- 기존 PROCESSING row는 legacy 진행 상태로 보존한다.

ALTER TYPE meeting_report_status ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE meeting_report_status ADD VALUE IF NOT EXISTS 'TRANSCRIBING';
ALTER TYPE meeting_report_status ADD VALUE IF NOT EXISTS 'SUMMARIZING';
