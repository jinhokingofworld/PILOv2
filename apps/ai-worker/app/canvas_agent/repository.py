from __future__ import annotations

import hashlib
import json
from typing import Any

from app.canvas_agent.types import (
    CanvasAgentJob,
    CanvasAgentRunContext,
    CanvasSemanticShapeMatch,
)


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

        return CanvasAgentRunContext(
            run_id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            canvas_id=str(row["canvas_id"]),
            requested_by_user_id=str(row["requested_by_user_id"]),
            status=str(row["status"]),
            prompt=str(row["prompt"]),
            request_context=_json_object(row["context_json"]),
            previous_action=previous_action,
        )

    def create_planned_action(
        self,
        context: CanvasAgentRunContext,
        action_name: str,
        action_input: dict[str, object],
        message: str,
        model_name: str,
    ) -> None:
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
                action_name,
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
                            "highlightedShapeIds": _shape_ids(action_input),
                            "targetViewport": None,
                        }
                    },
                    ensure_ascii=False,
                ),
                context.run_id,
            ),
        )

    def mark_failed(self, run_id: str, error_message: str) -> None:
        self.connection.execute(
            """
            UPDATE canvas_agent_runs
            SET status = 'failed', error_code = 'CANVAS_AGENT_PLANNER_FAILED',
                error_message = %s, result_summary = 'Canvas AI 작업을 완료하지 못했습니다.',
                completed_at = now()
            WHERE id = %s
              AND status NOT IN ('completed', 'cancelled', 'expired', 'draft_ready')
            """,
            (error_message[:4096], run_id),
        )

    def search_semantic_shapes(
        self,
        workspace_id: str,
        canvas_id: str,
        query_embedding: list[float],
        limit: int = 4,
    ) -> list[CanvasSemanticShapeMatch]:
        rows = self.connection.execute(
            """
            SELECT
              embedding.shape_id,
              1 - (embedding.embedding <=> %s::extensions.vector) AS similarity
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
            ORDER BY embedding.embedding <=> %s::extensions.vector
            LIMIT %s
            """,
            (
                _vector_literal(query_embedding),
                workspace_id,
                canvas_id,
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


def _advisory_lock_key(value: str) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(format(value, ".9g") for value in values) + "]"
