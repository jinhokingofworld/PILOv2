WITH ranked_field_values AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY project_item_id, field_name
      ORDER BY
        github_updated_at DESC NULLS LAST,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS duplicate_rank
  FROM public.github_project_v2_item_field_values
)
DELETE FROM public.github_project_v2_item_field_values field_value
USING ranked_field_values
WHERE field_value.ctid = ranked_field_values.ctid
  AND ranked_field_values.duplicate_rank > 1;

DO $$
DECLARE
  v_table regclass := 'public.github_project_v2_item_field_values'::regclass;
  v_project_item_attnum smallint;
  v_field_name_attnum smallint;
  v_has_unique_index boolean;
BEGIN
  SELECT attnum
    INTO v_project_item_attnum
  FROM pg_attribute
  WHERE attrelid = v_table
    AND attname = 'project_item_id'
    AND NOT attisdropped;

  SELECT attnum
    INTO v_field_name_attnum
  FROM pg_attribute
  WHERE attrelid = v_table
    AND attname = 'field_name'
    AND NOT attisdropped;

  SELECT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indrelid = v_table
      AND indisunique
      AND indpred IS NULL
      AND indexprs IS NULL
      AND indkey::text = concat(v_project_item_attnum, ' ', v_field_name_attnum)
  )
    INTO v_has_unique_index;

  IF NOT v_has_unique_index THEN
    CREATE UNIQUE INDEX uq_github_project_v2_item_field_values_item_field_name
      ON public.github_project_v2_item_field_values(project_item_id, field_name);
  END IF;
END $$;
