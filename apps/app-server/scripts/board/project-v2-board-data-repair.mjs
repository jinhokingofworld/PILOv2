#!/usr/bin/env node
import { chmodSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

import { planBoardRepair } from "./project-v2-board-data-repair-lib.mjs";

function parseArgs(argv) {
  const result = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") result.apply = true;
    else if (["--config", "--backup-path", "--rollback"].includes(value)) {
      if (!argv[index + 1]) throw new Error(`${value} requires a path`);
      result[value.slice(2).replace("-", "_")] = argv[++index];
    } else throw new Error(`unknown argument: ${value}`);
  }
  if (result.rollback) {
    if (result.config || result.apply || result.backup_path) {
      throw new Error("--rollback cannot be combined with repair arguments");
    }
  } else {
    if (!result.config) throw new Error("--config <json> is required");
    if (result.apply && !result.backup_path) {
      throw new Error("--apply requires --backup-path <path>");
    }
    if (!result.apply && result.backup_path) {
      throw new Error("--backup-path is valid only with --apply");
    }
  }
  return result;
}

function positiveId(value, label) {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`${label} must be a positive ID`);
  return text;
}

function validateConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("config must be an object");
  if (typeof raw.workspaceId !== "string" || !raw.workspaceId) throw new Error("workspaceId is required");
  if (!Array.isArray(raw.boardGroups) || raw.boardGroups.length === 0) throw new Error("boardGroups are required");
  const boardGroups = raw.boardGroups.map((group, groupIndex) => ({
    canonicalBoardId: positiveId(group.canonicalBoardId, `boardGroups[${groupIndex}].canonicalBoardId`),
    legacyBoardIds: (group.legacyBoardIds ?? []).map((id, index) =>
      positiveId(id, `boardGroups[${groupIndex}].legacyBoardIds[${index}]`))
  }));
  const allIds = boardGroups.flatMap((group) => [group.canonicalBoardId, ...group.legacyBoardIds]);
  if (new Set(allIds).size !== allIds.length) throw new Error("Board IDs must be unique across groups");
  const expected = raw.expected ?? {};
  for (const key of ["deliveryUpdates", "operationUpdates", "boardDeletes"]) {
    if (!Number.isSafeInteger(expected[key]) || expected[key] < 0) throw new Error(`expected.${key} is required`);
  }
  return { workspaceId: raw.workspaceId, boardGroups, expected };
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function mapRows(config, boardRows, columnRows, deliveryRows, operationRows) {
  const canonicalByBoard = new Map();
  for (const group of config.boardGroups) {
    canonicalByBoard.set(group.canonicalBoardId, group.canonicalBoardId);
    for (const id of group.legacyBoardIds) canonicalByBoard.set(id, group.canonicalBoardId);
  }
  return {
    boards: boardRows.map((row) => ({
      id: String(row.id),
      canonicalBoardId: canonicalByBoard.get(String(row.id)),
      referenceCount: Number(row.reference_count)
    })),
    columns: columnRows.map((row) => ({
      id: String(row.id), boardId: String(row.board_id), name: row.name,
      statusOptionGithubId: row.status_option_github_id
    })),
    deliveries: deliveryRows.map((row) => ({
      id: row.id, actionItemId: row.action_item_id, workspaceId: config.workspaceId,
      deliveryType: row.delivery_type, status: row.status,
      actionItemStatus: row.action_item_status,
      piloIssueId: row.pilo_issue_id === null ? null : String(row.pilo_issue_id),
      calendarEventId: row.calendar_event_id === null ? null : String(row.calendar_event_id),
      targetResourceId: row.target_resource_id,
      requestedByUserId: row.requested_by_user_id,
      actionItemTitle: row.action_item_title,
      actionItemDescription: row.action_item_description,
      idempotencyKey: row.idempotency_key, draftJson: row.draft_json
    })),
    operations: operationRows.map((row) => ({
      id: row.id, workspaceId: row.workspace_id, actorUserId: row.actor_user_id,
      boardId: String(row.board_id),
      columnId: String(row.column_id), idempotencyKey: row.idempotency_key,
      requestTitle: row.request_title, requestBody: row.request_body,
      requestHash: row.request_hash, status: row.status, completedStage: row.completed_stage
    }))
  };
}

async function takeSnapshot(client, config) {
  const boardIds = config.boardGroups.flatMap((group) => [group.canonicalBoardId, ...group.legacyBoardIds]);
  const boards = await client.query(`
    SELECT b.*,
      (SELECT count(*) FROM pilo_issues pi WHERE pi.board_id = b.id)
      + (SELECT count(*) FROM board_issue_create_operations op WHERE op.board_id = b.id)
      + (SELECT count(*) FROM workspace_board_settings ws WHERE ws.active_board_id = b.id)
      + (SELECT count(*) FROM meeting_report_action_item_deliveries d
          WHERE d.delivery_type = 'pilo_issue'
            AND d.draft_json #>> '{issue,boardId}' = b.id::text) AS reference_count
    FROM boards b
    WHERE b.workspace_id = $1 AND b.id = ANY($2::bigint[])
    ORDER BY b.id
    FOR UPDATE OF b
  `, [config.workspaceId, boardIds]);
  const found = new Set(boards.rows.map((row) => String(row.id)));
  for (const group of config.boardGroups) {
    if (!found.has(group.canonicalBoardId)) {
      throw new Error(`canonical Board ${group.canonicalBoardId} does not match the Workspace`);
    }
  }

  const columns = await client.query(`
    SELECT id, board_id, status_option_id, status_option_github_id,
           normalized_name, name, position, color, created_at, updated_at
    FROM board_columns WHERE board_id = ANY($1::bigint[])
    ORDER BY board_id, id FOR UPDATE
  `, [boardIds]);

  const legacyBoardIds = config.boardGroups.flatMap((group) => group.legacyBoardIds);
  const deliveries = await client.query(`
    SELECT d.*, ai.status AS action_item_status,
           ai.title AS action_item_title, ai.description AS action_item_description
    FROM meeting_report_action_item_deliveries d
    JOIN meeting_report_action_items ai ON ai.id = d.action_item_id
    JOIN meeting_reports mr ON mr.id = ai.meeting_report_id
    JOIN meetings m ON m.id = mr.meeting_id
    WHERE m.workspace_id = $1
      AND d.delivery_type = 'pilo_issue'
      AND d.draft_json #>> '{issue,boardId}' = ANY($2::text[])
    ORDER BY d.id FOR UPDATE OF d, ai
  `, [config.workspaceId, legacyBoardIds]);
  const keys = deliveries.rows.map((row) => row.idempotency_key);
  const operations = keys.length === 0 ? { rows: [] } : await client.query(`
    SELECT * FROM board_issue_create_operations
    WHERE workspace_id = $1 AND idempotency_key = ANY($2::text[])
    ORDER BY id FOR UPDATE
  `, [config.workspaceId, keys]);
  return { boards: boards.rows, columns: columns.rows, deliveries: deliveries.rows, operations: operations.rows };
}

function manifestFor(config, raw, plan) {
  const deliveries = plan.deliveryUpdates.map((update) => {
    const before = raw.deliveries.find((row) => String(row.id) === update.deliveryId);
    return {
      id: update.deliveryId,
      before: {
        boardId: String(before.draft_json.issue.boardId),
        columnId: String(before.draft_json.issue.columnId)
      },
      after: { boardId: update.boardId, columnId: update.columnId }
    };
  });
  const operations = plan.operationUpdates.map((update) => {
    const before = raw.operations.find((row) => String(row.id) === update.operationId);
    return {
      id: update.operationId,
      before: { boardId: String(before.board_id), columnId: String(before.column_id), requestHash: before.request_hash },
      after: update
    };
  });
  const deletedBoards = raw.boards.filter((row) => plan.deletableBoardIds.includes(String(row.id)));
  const deletedColumns = raw.columns.filter((row) => plan.deletableBoardIds.includes(String(row.board_id)));
  return { version: 1, workspaceId: config.workspaceId, deliveries, operations, deletedBoards, deletedColumns };
}

async function applyPlan(client, plan) {
  let deliveryCount = 0;
  for (const update of plan.deliveryUpdates) {
    const result = await client.query(`
      UPDATE meeting_report_action_item_deliveries
      SET draft_json = jsonb_set(
            jsonb_set(draft_json, '{issue,boardId}', to_jsonb($2::text), false),
            '{issue,columnId}', to_jsonb($3::text), false),
          updated_at = now()
      WHERE id = $1 AND delivery_type = 'pilo_issue' AND status = 'FAILED'
        AND pilo_issue_id IS NULL AND calendar_event_id IS NULL AND target_resource_id IS NULL
    `, [update.deliveryId, update.boardId, update.columnId]);
    deliveryCount += result.rowCount;
  }
  let operationCount = 0;
  for (const update of plan.operationUpdates) {
    const result = await client.query(`
      UPDATE board_issue_create_operations
      SET board_id = $2, column_id = $3, request_hash = $4, updated_at = now()
      WHERE id = $1 AND status = 'retryable' AND completed_stage = 'none'
    `, [update.operationId, update.boardId, update.columnId, update.requestHash]);
    operationCount += result.rowCount;
  }
  const deleted = plan.deletableBoardIds.length === 0 ? { rowCount: 0 } : await client.query(
    "DELETE FROM boards WHERE id = ANY($1::bigint[])", [plan.deletableBoardIds]);
  if (deliveryCount !== plan.counts.deliveryUpdates
    || operationCount !== plan.counts.operationUpdates
    || deleted.rowCount !== plan.counts.boardDeletes) {
    throw new Error("mutation row count mismatch");
  }
}

async function writeManifest(path, manifest) {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
}

async function runRepair(client, args, config) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const raw = await takeSnapshot(client, config);
    const plan = planBoardRepair(mapRows(config, raw.boards, raw.columns, raw.deliveries, raw.operations), {
      expectedDeliveryUpdates: config.expected.deliveryUpdates,
      expectedOperationUpdates: config.expected.operationUpdates,
      expectedBoardDeletes: config.expected.boardDeletes
    });
    const manifest = manifestFor(config, raw, plan);
    if (args.apply) {
      await writeManifest(args.backup_path, manifest);
      await applyPlan(client, plan);
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", ...plan.counts,
      retainedBoardIds: plan.retainedBoardIds, deletableBoardIds: plan.deletableBoardIds }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function runRollback(client, manifest) {
  if (manifest?.version !== 1 || !manifest.workspaceId) throw new Error("unsupported rollback manifest");
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    for (const row of manifest.deletedBoards) {
      const exists = await client.query("SELECT id FROM boards WHERE id = $1 FOR UPDATE", [row.id]);
      if (exists.rowCount !== 0) throw new Error(`rollback Board ${row.id} already exists`);
      await client.query(`INSERT INTO boards
        (id, workspace_id, repository_id, project_v2_id, status_field_id, name, last_sync_status,
         last_synced_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.id, row.workspace_id, row.repository_id, row.project_v2_id, row.status_field_id, row.name,
        row.last_sync_status, row.last_synced_at, row.created_at, row.updated_at]);
    }
    for (const row of manifest.deletedColumns) {
      await client.query(`INSERT INTO board_columns
        (id, board_id, status_option_id, status_option_github_id, normalized_name, name, position, color,
         created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.id, row.board_id, row.status_option_id, row.status_option_github_id, row.normalized_name,
        row.name, row.position, row.color, row.created_at, row.updated_at]);
    }
    for (const row of manifest.deliveries) {
      const result = await client.query(`UPDATE meeting_report_action_item_deliveries
        SET draft_json = jsonb_set(
              jsonb_set(draft_json, '{issue,boardId}', to_jsonb($2::text), false),
              '{issue,columnId}', to_jsonb($3::text), false),
            updated_at = now()
        WHERE id = $1 AND draft_json #>> '{issue,boardId}' = $4
          AND draft_json #>> '{issue,columnId}' = $5`,
      [row.id, row.before.boardId, row.before.columnId, row.after.boardId, row.after.columnId]);
      if (result.rowCount !== 1) throw new Error(`rollback delivery ${row.id} current state mismatch`);
    }
    for (const row of manifest.operations) {
      const result = await client.query(`UPDATE board_issue_create_operations
        SET board_id=$2, column_id=$3, request_hash=$4, updated_at=now()
        WHERE id=$1 AND board_id=$5 AND column_id=$6 AND request_hash=$7
          AND status='retryable' AND completed_stage='none'`,
      [row.id, row.before.boardId, row.before.columnId, row.before.requestHash,
        row.after.boardId, row.after.columnId, row.after.requestHash]);
      if (result.rowCount !== 1) throw new Error(`rollback operation ${row.id} current state mismatch`);
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ mode: "rollback", deliveries: manifest.deliveries.length,
      operations: manifest.operations.length, boards: manifest.deletedBoards.length }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const connectionString = process.env.BOARD_REPAIR_DATABASE_URL;
  if (!connectionString) throw new Error("BOARD_REPAIR_DATABASE_URL is required");
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    if (args.rollback) await runRollback(client, await loadJson(args.rollback));
    else await runRepair(client, args, validateConfig(await loadJson(args.config)));
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
