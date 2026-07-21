from __future__ import annotations

import hashlib
import json
from typing import Any

from app.canvas_agent.types import (
    CanvasAgentJob,
    CanvasAgentRunContext,
    CanvasSemanticShapeMatch,
)

CODE_GENERATION_FAILURE_MESSAGE = "코드 생성 중 오류가 났어요. 다시 시도해 주세요."
CODE_GENERATION_TIMEOUT_MESSAGE = "코드 생성 시간이 초과됐어요. 다시 시도해 주세요."
GENERIC_FAILURE_MESSAGE = "Canvas AI 작업을 완료하지 못했습니다."


class PgCanvasAgentRepository:
    def __init__(self, database_url: str, database_ssl: bool) -> None:
        import psycopg
        from psycopg.rows import dict_row

        kwargs: dict[str, Any] = {"autocommit": True, "row_factory": dict_row}
        if database_ssl:
            kwargs["sslmode"] = "require"
        self.connection = psycopg.connect(database_url, **kwargs)

    def close(self) -> None:
        self.connection.close()

    def try_acquire_run_lock(self, run_id: str) -> bool:
        row = self.connection.execute(
            "SELECT pg_try_advisory_lock(%s) AS acquired", (_advisory_lock_key(run_id),)
        ).fetchone()
        return bool(row["acquired"])

    def release_run_lock(self, run_id: str) -> None:
        self.connection.execute("SELECT pg_advisory_unlock(%s)", (_advisory_lock_key(run_id),))

    def get_run_context(self, job: CanvasAgentJob) -> CanvasAgentRunContext | None:
        row = self.connection.execute(
            """
            SELECT id, workspace_id, canvas_id, requested_by_user_id, status, prompt, context_json
            FROM canvas_agent_runs
            WHERE id = %s
              AND workspace_id = %s
              AND canvas_id = %s
              AND requested_by_user_id = %s
            LIMIT 1
            """,
            (job.run_id, job.workspace_id, job.canvas_id, job.requested_by_user_id),
        ).fetchone()
        if row is None:
            return None

        previous = self.connection.execute(
            """
            SELECT action_name, input_json, output_json, resource_refs
            FROM canvas_agent_steps
            WHERE run_id = %s
              AND status = 'completed'
            ORDER BY step_order DESC
            LIMIT 1
            """,
            (job.run_id,),
        ).fetchone()
        previous_action: dict[str, object] | None = None
        if previous is not None:
            previous_action = {
                "actionName": str(previous["action_name"]),
                "input": _json_object(previous["input_json"]),
                "output": _json_object(previous["output_json"]),
                "resourceRefs": _json_list(previous["resource_refs"]),
            }

        request_context = _json_object(row["context_json"])
        selected_shape_ids = _string_list(request_context.get("selectedShapeIds"))[:12]
        client_shape_summaries = _json_list(request_context.get("shapeSummaries"))
        if selected_shape_ids and not client_shape_summaries:
            request_context["selectedShapeSummaries"] = self._selected_shape_summaries(
                str(row["canvas_id"]),
                selected_shape_ids,
            )

        return CanvasAgentRunContext(
            run_id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            canvas_id=str(row["canvas_id"]),
            requested_by_user_id=str(row["requested_by_user_id"]),
            status=str(row["status"]),
            prompt=str(row["prompt"]),
            request_context=request_context,
            previous_action=previous_action,
        )

    def _selected_shape_summaries(
        self,
        canvas_id: str,
        shape_ids: list[str],
    ) -> list[dict[str, object]]:
        if not shape_ids:
            return []
        rows = self.connection.execute(
            """
            SELECT id, title, text_content, shape_type, raw_shape
            FROM canvas_freeform_shapes
            WHERE canvas_id = %s
              AND deleted_at IS NULL
              AND (
                id = ANY(%s::text[])
                OR raw_shape->>'parentId' = ANY(%s::text[])
              )
            ORDER BY
              CASE WHEN id = ANY(%s::text[]) THEN 0 ELSE 1 END,
              array_position(%s::text[], COALESCE(raw_shape->>'parentId', id)),
              id
            LIMIT 40
            """,
            (canvas_id, shape_ids, shape_ids, shape_ids, shape_ids),
        ).fetchall()

        return [_shape_summary(row) for row in rows]

    def create_classified_intent(
        self,
        context: CanvasAgentRunContext,
        intent: str,
        arguments: dict[str, object],
        message: str,
        model_name: str,
    ) -> None:
        action_input = {
            "intent": intent,
            "arguments": arguments,
        }
        self.connection.execute(
            """
            WITH next_step AS (
              SELECT COALESCE(MAX(step_order), 0) + 1 AS step_order
              FROM canvas_agent_steps
              WHERE run_id = %s
            )
            INSERT INTO canvas_agent_steps (
              run_id, step_order, action_name, status, input_json, output_json,
              resource_refs, model_name
            )
            SELECT %s, next_step.step_order, %s, 'pending', %s::jsonb, '{}'::jsonb,
              '[]'::jsonb, %s
            FROM next_step
            """,
            (
                context.run_id,
                context.run_id,
                "route_intent",
                json.dumps(action_input, ensure_ascii=False),
                model_name,
            ),
        )
        self.connection.execute(
            """
            UPDATE canvas_agent_runs
            SET status = 'executing', result_summary = %s,
                result_json = %s::jsonb, error_code = NULL, error_message = NULL
            WHERE id = %s
              AND status = 'planning'
            """,
            (
                message,
                json.dumps(
                    {
                        "progress": {
                            "message": message,
                            "highlightedShapeIds": _shape_ids(arguments),
                            "targetViewport": None,
                        }
                    },
                    ensure_ascii=False,
                ),
                context.run_id,
            ),
        )

    def update_progress(self, run_id: str, message: str) -> None:
        self.connection.execute(
            """
            UPDATE canvas_agent_runs
            SET result_summary = %s,
                result_json = %s::jsonb,
                error_code = NULL,
                error_message = NULL
            WHERE id = %s
              AND status = 'planning'
            """,
            (
                message,
                json.dumps(
                    {
                        "progress": {
                            "message": message,
                            "highlightedShapeIds": [],
                            "targetViewport": None,
                        }
                    },
                    ensure_ascii=False,
                ),
                run_id,
            ),
        )

    def mark_failed(self, run_id: str, error_message: str) -> None:
        safe_error_message = error_message[:4096]
        user_message = (
            safe_error_message
            if safe_error_message
            in {CODE_GENERATION_FAILURE_MESSAGE, CODE_GENERATION_TIMEOUT_MESSAGE}
            else GENERIC_FAILURE_MESSAGE
        )
        self.connection.execute(
            """
            UPDATE canvas_agent_runs
            SET status = 'failed', error_code = 'CANVAS_AGENT_PLANNER_FAILED',
                error_message = %s,
                result_summary = %s,
                result_json = jsonb_set(
                    COALESCE(result_json, '{}'::jsonb),
                    '{progress}',
                    jsonb_build_object(
                        'message', %s,
                        'highlightedShapeIds', '[]'::jsonb,
                        'targetViewport', NULL,
                        'toolTarget', NULL,
                        'toolTargetLabel', NULL
                    ),
                    true
                ),
                completed_at = now()
            WHERE id = %s
              AND status NOT IN ('completed', 'cancelled', 'expired', 'draft_ready')
            """,
            (
                safe_error_message,
                user_message,
                user_message,
                run_id,
            ),
        )

    def fail_planning_after_retry_exhaustion(self, run_id: str) -> bool:
        if not self.try_acquire_run_lock(run_id):
            return False
        try:
            cursor = self.connection.execute(
                """
                UPDATE canvas_agent_runs
                SET status = 'failed',
                    error_code = 'CANVAS_AGENT_PLANNER_RETRY_EXHAUSTED',
                    error_message = 'Canvas AI request could not be planned. Please try again.',
                    result_summary = %s,
                    result_json = jsonb_set(
                        COALESCE(result_json, '{}'::jsonb),
                        '{progress}',
                        jsonb_build_object(
                            'message', %s,
                            'highlightedShapeIds', '[]'::jsonb,
                            'targetViewport', NULL,
                            'toolTarget', NULL,
                            'toolTargetLabel', NULL
                        ),
                        true
                    ),
                    completed_at = now()
                WHERE id = %s
                  AND status IN ('queued', 'planning')
                """,
                (
                    GENERIC_FAILURE_MESSAGE,
                    GENERIC_FAILURE_MESSAGE,
                    run_id,
                ),
            )
            return cursor.rowcount > 0
        finally:
            self.release_run_lock(run_id)

    def has_semantic_shapes(self, workspace_id: str, canvas_id: str) -> bool:
        row = self.connection.execute(
            """
            SELECT 1
            FROM canvas_agent_shape_embeddings embedding
            INNER JOIN canvas_freeform_shapes shape ON shape.id = embedding.shape_id
            WHERE embedding.workspace_id = %s
              AND embedding.canvas_id = %s
              AND shape.canvas_id = embedding.canvas_id
              AND shape.deleted_at IS NULL
              AND shape.revision = embedding.shape_revision
            LIMIT 1
            """,
            (workspace_id, canvas_id),
        ).fetchone()
        return row is not None

    def search_text_shapes(
        self,
        workspace_id: str,
        canvas_id: str,
        query: str,
        limit: int = 4,
    ) -> list[CanvasSemanticShapeMatch]:
        normalized = query.strip()
        if not normalized:
            return []

        exact_pattern = f"%{_escape_like(normalized)}%"
        term_patterns = [f"%{_escape_like(term)}%" for term in _search_terms(normalized)]
        rows = self.connection.execute(
            """
            WITH scoped_shapes AS MATERIALIZED (
              SELECT
                shape.id,
                shape.updated_at,
                concat_ws(
                  ' ',
                  COALESCE(shape.title, ''),
                  COALESCE(shape.text_content, ''),
                  shape.shape_type
                ) AS searchable_text
              FROM canvas_freeform_shapes shape
              INNER JOIN canvas board ON board.id = shape.canvas_id
              WHERE board.workspace_id = %s
                AND board.id = %s
                AND board.board_type = 'freeform'
                AND shape.canvas_id = %s
                AND shape.deleted_at IS NULL
            )
            SELECT
              id,
              CASE
                WHEN searchable_text ILIKE %s ESCAPE '\\' THEN 1.0
                WHEN cardinality(%s::text[]) > 0
                  AND NOT EXISTS (
                    SELECT 1
                    FROM unnest(%s::text[]) AS search_term(pattern)
                    WHERE searchable_text NOT ILIKE search_term.pattern ESCAPE '\\'
                  ) THEN 0.95
                ELSE 0.8
              END AS similarity
            FROM scoped_shapes
            WHERE searchable_text ILIKE %s ESCAPE '\\'
              OR EXISTS (
                SELECT 1
                FROM unnest(%s::text[]) AS search_term(pattern)
                WHERE searchable_text ILIKE search_term.pattern ESCAPE '\\'
              )
            ORDER BY similarity DESC, updated_at DESC, id ASC
            LIMIT %s
            """,
            (
                workspace_id,
                canvas_id,
                canvas_id,
                exact_pattern,
                term_patterns,
                term_patterns,
                exact_pattern,
                term_patterns,
                max(1, min(limit, 20)),
            ),
        ).fetchall()

        return [
            CanvasSemanticShapeMatch(
                shape_id=str(row["id"]),
                similarity=float(row["similarity"]),
            )
            for row in rows
        ]

    def search_semantic_shapes(
        self,
        workspace_id: str,
        canvas_id: str,
        query_embedding: list[float],
        limit: int = 4,
    ) -> list[CanvasSemanticShapeMatch]:
        rows = self.connection.execute(
            """
            WITH canvas_embeddings AS MATERIALIZED (
              SELECT
                embedding.shape_id,
                embedding.embedding
              FROM canvas_agent_shape_embeddings embedding
              INNER JOIN canvas_freeform_shapes shape ON shape.id = embedding.shape_id
              WHERE embedding.workspace_id = %s
                AND embedding.canvas_id = %s
                AND shape.canvas_id = embedding.canvas_id
                AND shape.deleted_at IS NULL
                AND shape.revision = embedding.shape_revision
                AND encode(
                  digest(
                    concat_ws(
                      E'\\n',
                      shape.shape_type,
                      COALESCE(shape.title, ''),
                      COALESCE(shape.text_content, '')
                    ),
                    'sha256'
                  ),
                  'hex'
                ) = embedding.source_text_hash
            )
            SELECT
              shape_id,
              1 - (embedding OPERATOR(extensions.<=>) %s::extensions.vector) AS similarity
            FROM canvas_embeddings
            ORDER BY embedding OPERATOR(extensions.<=>) %s::extensions.vector
            LIMIT %s
            """,
            (
                workspace_id,
                canvas_id,
                _vector_literal(query_embedding),
                _vector_literal(query_embedding),
                max(1, min(limit, 20)),
            ),
        ).fetchall()
        return [
            CanvasSemanticShapeMatch(
                shape_id=str(row["shape_id"]),
                similarity=float(row["similarity"]),
            )
            for row in rows
        ]

    def claim_embedding_job(self) -> dict[str, object] | None:
        with self.connection.transaction():
            return self.connection.execute(
                """
                WITH candidate AS (
                  SELECT id
                  FROM canvas_agent_shape_embedding_jobs
                  WHERE status = 'pending'
                  ORDER BY created_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
                )
                UPDATE canvas_agent_shape_embedding_jobs job
                SET
                  status = 'processing',
                  attempt_count = attempt_count + 1,
                  claimed_at = now(),
                  error_code = NULL,
                  error_message = NULL
                FROM candidate
                WHERE job.id = candidate.id
                RETURNING job.*
                """
            ).fetchone()

    def get_shape_embedding_source(self, job: dict[str, object]) -> dict[str, object] | None:
        return self.connection.execute(
            """
            SELECT
              shape.id,
              shape.shape_type,
              shape.title,
              shape.text_content,
              shape.revision,
              canvas.workspace_id,
              canvas.id AS canvas_id,
              encode(
                digest(
                  concat_ws(
                    E'\\n',
                    shape.shape_type,
                    COALESCE(shape.title, ''),
                    COALESCE(shape.text_content, '')
                  ),
                  'sha256'
                ),
                'hex'
              ) AS source_text_hash
            FROM canvas_freeform_shapes shape
            INNER JOIN canvas ON canvas.id = shape.canvas_id
            WHERE shape.id = %s
              AND shape.canvas_id = %s
              AND canvas.workspace_id = %s
              AND canvas.board_type = 'freeform'
              AND shape.deleted_at IS NULL
              AND shape.revision = %s
            LIMIT 1
            """,
            (
                job["shape_id"],
                job["canvas_id"],
                job["workspace_id"],
                job["expected_shape_revision"],
            ),
        ).fetchone()

    def upsert_shape_embedding(
        self,
        job: dict[str, object],
        embedding: list[float],
        model_name: str,
        model_version: str,
    ) -> bool:
        source_hash = str(job["expected_source_text_hash"])
        result = self.connection.execute(
            """
            INSERT INTO canvas_agent_shape_embeddings (
              shape_id,
              workspace_id,
              canvas_id,
              shape_revision,
              source_text_hash,
              embedding,
              embedding_model,
              embedding_version,
              indexed_at
            )
            SELECT
              shape.id,
              canvas.workspace_id,
              canvas.id,
              shape.revision,
              %s,
              %s::extensions.vector,
              %s,
              %s,
              now()
            FROM canvas_freeform_shapes shape
            INNER JOIN canvas ON canvas.id = shape.canvas_id
            WHERE shape.id = %s
              AND shape.canvas_id = %s
              AND canvas.workspace_id = %s
              AND canvas.board_type = 'freeform'
              AND shape.deleted_at IS NULL
              AND shape.revision = %s
              AND encode(
                digest(
                  concat_ws(
                    E'\\n',
                    shape.shape_type,
                    COALESCE(shape.title, ''),
                    COALESCE(shape.text_content, '')
                  ),
                  'sha256'
                ),
                'hex'
              ) = %s
            ON CONFLICT (shape_id) DO UPDATE
            SET
              workspace_id = EXCLUDED.workspace_id,
              canvas_id = EXCLUDED.canvas_id,
              shape_revision = EXCLUDED.shape_revision,
              source_text_hash = EXCLUDED.source_text_hash,
              embedding = EXCLUDED.embedding,
              embedding_model = EXCLUDED.embedding_model,
              embedding_version = EXCLUDED.embedding_version,
              indexed_at = EXCLUDED.indexed_at
            """,
            (
                source_hash,
                _vector_literal(embedding),
                model_name,
                model_version,
                job["shape_id"],
                job["canvas_id"],
                job["workspace_id"],
                job["expected_shape_revision"],
                source_hash,
            ),
        )
        return result.rowcount == 1

    def delete_shape_embedding(self, shape_id: str) -> None:
        self.connection.execute(
            "DELETE FROM canvas_agent_shape_embeddings WHERE shape_id = %s",
            (shape_id,),
        )

    def complete_embedding_job(self, job_id: str) -> None:
        self.connection.execute(
            """
            UPDATE canvas_agent_shape_embedding_jobs
            SET status = 'completed', completed_at = now()
            WHERE id = %s
              AND status = 'processing'
            """,
            (job_id,),
        )

    def supersede_embedding_job(self, job_id: str) -> None:
        self.connection.execute(
            """
            UPDATE canvas_agent_shape_embedding_jobs
            SET status = 'superseded', completed_at = now()
            WHERE id = %s
              AND status = 'processing'
            """,
            (job_id,),
        )

    def fail_embedding_job(self, job_id: str, message: str) -> None:
        self.connection.execute(
            """
            UPDATE canvas_agent_shape_embedding_jobs
            SET status = 'failed', error_code = 'CANVAS_EMBEDDING_FAILED',
                error_message = %s, completed_at = now()
            WHERE id = %s
              AND status = 'processing'
            """,
            (message[:4096], job_id),
        )


def _shape_summary(row: dict[str, object]) -> dict[str, object]:
    raw_shape = _json_object(row.get("raw_shape"))
    props = _json_object(raw_shape.get("props"))
    parent_id = raw_shape.get("parentId")
    title = _clean_text(
        row.get("title") or props.get("fileName") or props.get("name") or props.get("title")
    )
    text = _clean_text(
        row.get("text_content")
        or props.get("text")
        or props.get("label")
        or props.get("placeholder")
    )
    summary: dict[str, object] = {
        "id": str(row.get("id", "")),
        "shapeType": str(row.get("shape_type", "")),
    }
    if isinstance(parent_id, str) and parent_id:
        summary["parentId"] = parent_id[:120]
    if title:
        summary["title"] = title[:160]
    if text:
        summary["text"] = text[:800]

    code = _clean_text(props.get("code"))
    if code:
        summary["codePreview"] = code[:1000]

    return summary


def _clean_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _json_object(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return {str(key): item for key, item in value.items()}
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _json_list(value: object) -> list[object]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _shape_ids(action_input: dict[str, object]) -> list[str]:
    for key in ("shapeIds", "sourceShapeIds"):
        value = action_input.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, str)][:40]
    return []


def _search_terms(query: str) -> list[str]:
    stop_words = {
        "canvas",
        "shape",
        "캔버스",
        "쉐입",
        "도형",
        "메모",
        "노트",
        "찾아",
        "찾아줘",
        "검색",
        "검색해",
        "검색해줘",
        "보여",
        "보여줘",
        "어디",
        "위치",
        "이동",
        "가줘",
        "있는",
        "관련",
    }
    terms: list[str] = []
    for term in query.replace("/", " ").replace("_", " ").split():
        normalized = term.strip(" \t\n\r\"'`“”‘’.,!?()[]{}")
        if len(normalized) < 2 or normalized.lower() in stop_words:
            continue
        if normalized not in terms:
            terms.append(normalized[:80])
    return terms[:12]


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _advisory_lock_key(value: str) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(format(value, ".9g") for value in values) + "]"
