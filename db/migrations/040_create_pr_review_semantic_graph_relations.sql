BEGIN;

ALTER TABLE public.review_files
  ADD COLUMN role_type TEXT NOT NULL DEFAULT 'unknown',
  ADD CONSTRAINT review_files_role_type_check
    CHECK (
      role_type IN (
        'entry',
        'core_logic',
        'api_contract',
        'ui_state',
        'verification',
        'support',
        'unknown'
      )
    );

ALTER TABLE public.review_flow_files
  ADD CONSTRAINT uq_review_flow_files_session_flow_id
  UNIQUE (session_id, flow_id, id);

CREATE TABLE public.review_flow_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  session_id UUID NOT NULL,
  flow_id UUID NOT NULL,
  from_review_flow_file_id UUID NOT NULL,
  to_review_flow_file_id UUID NOT NULL,

  relation_type TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence SMALLINT NOT NULL,
  reason TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT review_flow_relations_flow_same_session_fk
    FOREIGN KEY (session_id, flow_id)
    REFERENCES public.review_flows(session_id, id)
    ON DELETE CASCADE,

  CONSTRAINT review_flow_relations_from_file_same_flow_fk
    FOREIGN KEY (session_id, flow_id, from_review_flow_file_id)
    REFERENCES public.review_flow_files(session_id, flow_id, id)
    ON DELETE CASCADE,

  CONSTRAINT review_flow_relations_to_file_same_flow_fk
    FOREIGN KEY (session_id, flow_id, to_review_flow_file_id)
    REFERENCES public.review_flow_files(session_id, flow_id, id)
    ON DELETE CASCADE,

  CONSTRAINT review_flow_relations_unique_relation
    UNIQUE (
      flow_id,
      from_review_flow_file_id,
      to_review_flow_file_id,
      relation_type
    ),

  CONSTRAINT review_flow_relations_distinct_files_check
    CHECK (from_review_flow_file_id <> to_review_flow_file_id),

  CONSTRAINT review_flow_relations_type_check
    CHECK (
      relation_type IN (
        'depends_on',
        'tests',
        'uses_api',
        'passes_data_to',
        'supports'
      )
    ),

  CONSTRAINT review_flow_relations_source_check
    CHECK (source IN ('rule', 'ai', 'hybrid')),

  CONSTRAINT review_flow_relations_confidence_check
    CHECK (confidence BETWEEN 0 AND 100),

  CONSTRAINT review_flow_relations_reason_check
    CHECK (
      reason = btrim(reason)
      AND octet_length(reason) BETWEEN 1 AND 500
    )
);

CREATE INDEX idx_review_flow_relations_session_flow
  ON public.review_flow_relations(session_id, flow_id);

CREATE INDEX idx_review_flow_relations_from_file
  ON public.review_flow_relations(from_review_flow_file_id);

CREATE INDEX idx_review_flow_relations_to_file
  ON public.review_flow_relations(to_review_flow_file_id);

CREATE TRIGGER trg_review_flow_relations_updated_at
BEFORE UPDATE ON public.review_flow_relations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.review_flow_relations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.review_flow_relations IS
  'Validated semantic relations between two file memberships in one PR Review flow.';

COMMIT;
