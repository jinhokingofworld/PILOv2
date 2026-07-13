BEGIN;

CREATE TABLE public.meeting_report_transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL REFERENCES public.meeting_reports(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER NOT NULL,
  speaker_label TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meeting_report_transcript_segments_order_unique UNIQUE (meeting_report_id, segment_index),
  CONSTRAINT meeting_report_transcript_segments_time_check CHECK (started_at_ms >= 0 AND ended_at_ms > started_at_ms),
  CONSTRAINT meeting_report_transcript_segments_text_check CHECK (octet_length(text) BETWEEN 1 AND 16000)
);

CREATE INDEX idx_meeting_report_transcript_segments_report_time
  ON public.meeting_report_transcript_segments (meeting_report_id, started_at_ms, segment_index);

CREATE TABLE public.meeting_report_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL REFERENCES public.meeting_reports(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_index INTEGER NOT NULL,
  transcript_segment_id UUID NOT NULL REFERENCES public.meeting_report_transcript_segments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meeting_report_evidence_source_type_check CHECK (source_type IN ('summary', 'discussion', 'decision', 'action_item')),
  CONSTRAINT meeting_report_evidence_source_index_check CHECK (source_index >= 0),
  CONSTRAINT meeting_report_evidence_unique UNIQUE (meeting_report_id, source_type, source_index, transcript_segment_id)
);

CREATE INDEX idx_meeting_report_evidence_report_source
  ON public.meeting_report_evidence (meeting_report_id, source_type, source_index);

ALTER TABLE public.meeting_report_transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_report_evidence ENABLE ROW LEVEL SECURITY;

COMMIT;
