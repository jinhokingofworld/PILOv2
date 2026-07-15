BEGIN;

CREATE OR REPLACE FUNCTION public.hydrate_pilo_board_from_github(
  p_project_v2_id UUID,
  p_repository_id UUID
)
RETURNS BIGINT AS $$
DECLARE
  v_board_id BIGINT;
BEGIN
  INSERT INTO boards (
    name,
    workspace_id,
    repository_id,
    project_v2_id,
    status_field_id,
    last_sync_status,
    last_synced_at
  )
  SELECT
    gp.title,
    gp.workspace_id,
    gr.id AS repository_id,
    gp.id AS project_v2_id,
    sf.id AS status_field_id,
    'success'::github_sync_status,
    now()
  FROM github_projects_v2 gp
  JOIN github_project_v2_repositories gpr
    ON gpr.project_v2_id = gp.id
  JOIN github_repositories gr
    ON gr.id = gpr.repository_id
  LEFT JOIN github_project_v2_fields sf
    ON sf.project_v2_id = gp.id
   AND sf.is_status_field = true
  WHERE gp.id = p_project_v2_id
    AND gr.id = p_repository_id
    AND gp.workspace_id = gr.workspace_id
  ON CONFLICT (project_v2_id, repository_id)
  DO UPDATE SET
    name = EXCLUDED.name,
    workspace_id = EXCLUDED.workspace_id,
    status_field_id = EXCLUDED.status_field_id,
    last_sync_status = EXCLUDED.last_sync_status,
    last_synced_at = EXCLUDED.last_synced_at,
    updated_at = now()
  RETURNING id INTO v_board_id;

  INSERT INTO board_columns (
    board_id,
    name,
    position,
    color,
    status_option_id,
    status_option_github_id,
    normalized_name
  )
  SELECT
    b.id AS board_id,
    o.option_name AS name,
    COALESCE(o.position, 0) AS position,
    o.color,
    o.id AS status_option_id,
    o.github_option_id AS status_option_github_id,
    o.normalized_name
  FROM boards b
  JOIN github_project_v2_fields sf
    ON sf.id = b.status_field_id
  JOIN github_project_v2_field_options o
    ON o.field_id = sf.id
  WHERE b.id = v_board_id
  ON CONFLICT (board_id, status_option_id)
  DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    color = EXCLUDED.color,
    status_option_github_id = EXCLUDED.status_option_github_id,
    normalized_name = EXCLUDED.normalized_name,
    updated_at = now();

  INSERT INTO board_columns (
    board_id,
    name,
    position,
    color,
    normalized_name
  )
  SELECT
    b.id,
    'Unmapped',
    COALESCE((
      SELECT MAX(existing.position) + 1
      FROM board_columns existing
      WHERE existing.board_id = b.id
    ), 0),
    '#8a93a6',
    'unmapped'
  FROM boards b
  WHERE b.id = v_board_id
    AND NOT EXISTS (
      SELECT 1
      FROM board_columns bc
      WHERE bc.board_id = b.id
        AND bc.normalized_name = 'unmapped'
    );

  PERFORM refresh_pilo_issues_from_github(v_board_id);

  RETURN v_board_id;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMIT;
