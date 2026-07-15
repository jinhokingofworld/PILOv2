BEGIN;

CREATE TABLE public.meeting_report_activity_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL
    REFERENCES public.meeting_reports(id) ON DELETE CASCADE,
  activity_log_id UUID NOT NULL
    REFERENCES public.activity_logs(id) ON DELETE CASCADE,
  source_index INTEGER NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  action activity_log_action NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_activity_evidence_source_index_check
    CHECK (source_index >= 0),
  CONSTRAINT meeting_report_activity_evidence_summary_check
    CHECK (octet_length(summary) BETWEEN 1 AND 500),
  CONSTRAINT meeting_report_activity_evidence_report_source_unique
    UNIQUE (meeting_report_id, source_index),
  CONSTRAINT meeting_report_activity_evidence_report_activity_unique
    UNIQUE (meeting_report_id, activity_log_id),
  CONSTRAINT meeting_report_activity_evidence_report_id_unique
    UNIQUE (meeting_report_id, id)
);

CREATE INDEX idx_meeting_report_activity_evidence_report_occurred
  ON public.meeting_report_activity_evidence (
    meeting_report_id,
    occurred_at ASC,
    source_index ASC
  );

CREATE TABLE public.meeting_report_activity_evidence_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  source_index INTEGER NOT NULL,
  activity_evidence_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_activity_evidence_references_source_type_check
    CHECK (source_type IN ('summary', 'discussion', 'decision', 'action_item')),
  CONSTRAINT meeting_report_activity_evidence_references_source_index_check
    CHECK (source_index >= 0),
  CONSTRAINT meeting_report_activity_evidence_references_unique
    UNIQUE (meeting_report_id, source_type, source_index, activity_evidence_id),
  CONSTRAINT meeting_report_activity_evidence_references_activity_fk
    FOREIGN KEY (meeting_report_id, activity_evidence_id)
    REFERENCES public.meeting_report_activity_evidence (meeting_report_id, id)
    ON DELETE CASCADE
);

CREATE INDEX idx_meeting_report_activity_evidence_references_report_source
  ON public.meeting_report_activity_evidence_references (
    meeting_report_id,
    source_type,
    source_index
  );

ALTER TABLE public.meeting_report_activity_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_report_activity_evidence_references ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meeting_report_activity_evidence IS
  'Bounded safe Activity Log projections used as MeetingReport evidence. Raw Activity Log metadata is never copied here.';

COMMENT ON TABLE public.meeting_report_activity_evidence_references IS
  'Links a MeetingReport output source to one Activity evidence snapshot from the same report.';

COMMIT;
