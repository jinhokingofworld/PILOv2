CREATE OR REPLACE FUNCTION refresh_pilo_issues_from_github(
  p_board_id BIGINT
)
RETURNS VOID AS $$
BEGIN
  DELETE FROM pilo_issues pi
  USING boards b
  WHERE b.id = p_board_id
    AND pi.board_id = b.id
    AND NOT EXISTS (
      SELECT 1
      FROM github_project_v2_items gpi
      WHERE gpi.project_v2_id = b.project_v2_id
        AND gpi.workspace_id = b.workspace_id
        AND gpi.id = pi.project_item_id
        AND gpi.issue_id = pi.github_issue_id
        AND gpi.content_type = 'ISSUE'
        AND gpi.is_archived = false
    );

  WITH position_offset AS (
    SELECT COALESCE(MAX(pi.position), 0) + 1 AS offset_value
    FROM pilo_issues pi
    WHERE pi.board_id = p_board_id
  )
  UPDATE pilo_issues pi
  SET position = pi.position + position_offset.offset_value
  FROM position_offset
  WHERE pi.board_id = p_board_id;

  WITH positioned_source_items AS (
    SELECT
      b.id AS board_id,
      b.workspace_id,
      b.repository_id,
      gi.id AS github_issue_id,
      gi.github_node_id AS github_issue_node_id,
      gi.issue_number AS github_issue_number,
      gi.title,
      gi.body,
      gi.html_url,
      gi.state,
      gi.labels,
      gi.assignees,
      gi.milestone,
      gi.github_updated_at,
      gi.raw,
      gpi.id AS project_item_id,
      gpi.github_project_item_node_id,
      gpi.position AS remote_position,
      COALESCE(status_col.id, fallback_col.id) AS column_id
    FROM boards b
    JOIN github_project_v2_items gpi
      ON gpi.project_v2_id = b.project_v2_id
     AND gpi.workspace_id = b.workspace_id
    JOIN github_issues gi
      ON gi.id = gpi.issue_id
     AND gi.workspace_id = b.workspace_id
     AND gi.repository_id = b.repository_id
    LEFT JOIN board_columns status_col
      ON status_col.board_id = b.id
     AND (
        status_col.status_option_id = gpi.status_option_id
        OR status_col.status_option_github_id = gpi.status_option_github_id
        OR status_col.normalized_name = gpi.status_normalized_name
     )
    JOIN board_columns fallback_col
      ON fallback_col.board_id = b.id
     AND fallback_col.normalized_name = 'unmapped'
    WHERE b.id = p_board_id
      AND gpi.content_type = 'ISSUE'
      AND gpi.is_archived = false
  ),
  source_items AS (
    SELECT
      positioned_source_items.*,
      ROW_NUMBER() OVER (
        PARTITION BY positioned_source_items.column_id
        ORDER BY positioned_source_items.remote_position ASC NULLS LAST,
          positioned_source_items.github_updated_at ASC NULLS LAST,
          positioned_source_items.github_project_item_node_id ASC,
          positioned_source_items.project_item_id ASC
      ) - 1 AS item_position
    FROM positioned_source_items
  )
  INSERT INTO pilo_issues (
    board_id,
    column_id,
    workspace_id,
    repository_id,
    github_issue_id,
    project_item_id,
    github_issue_node_id,
    github_project_item_node_id,
    github_issue_number,
    issue_number,
    title,
    body,
    html_url,
    state,
    labels,
    assignees,
    milestone,
    position,
    github_updated_at,
    last_synced_at,
    raw
  )
  SELECT
    board_id,
    column_id,
    workspace_id,
    repository_id,
    github_issue_id,
    project_item_id,
    github_issue_node_id,
    github_project_item_node_id,
    github_issue_number,
    '#' || github_issue_number::text AS issue_number,
    title,
    body,
    html_url,
    state,
    labels,
    assignees,
    milestone,
    item_position,
    github_updated_at,
    now(),
    raw
  FROM source_items
  ON CONFLICT (board_id, issue_number)
  DO UPDATE SET
    column_id = EXCLUDED.column_id,
    workspace_id = EXCLUDED.workspace_id,
    repository_id = EXCLUDED.repository_id,
    github_issue_id = EXCLUDED.github_issue_id,
    project_item_id = EXCLUDED.project_item_id,
    github_issue_node_id = EXCLUDED.github_issue_node_id,
    github_project_item_node_id = EXCLUDED.github_project_item_node_id,
    github_issue_number = EXCLUDED.github_issue_number,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    html_url = EXCLUDED.html_url,
    state = EXCLUDED.state,
    labels = EXCLUDED.labels,
    assignees = EXCLUDED.assignees,
    milestone = EXCLUDED.milestone,
    position = EXCLUDED.position,
    github_updated_at = EXCLUDED.github_updated_at,
    last_synced_at = now(),
    raw = EXCLUDED.raw,
    updated_at = now();
END;
$$ LANGUAGE plpgsql;
