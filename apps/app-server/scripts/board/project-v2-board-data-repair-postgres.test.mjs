import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashBoardIssueRequest } from "./project-v2-board-data-repair-lib.mjs";

const connectionString = process.env.BOARD_POSTGRES_TEST_URL;
if (!connectionString) {
  console.log("project-v2 Board repair PostgreSQL test skipped: BOARD_POSTGRES_TEST_URL is not set");
} else {
  const url = new URL(connectionString);
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!loopback.has(url.hostname) || url.pathname !== "/pilo_board_data_repair_test") {
    throw new Error("BOARD_POSTGRES_TEST_URL must target loopback database pilo_board_data_repair_test");
  }

  const { Pool } = pg;
  const pool = new Pool({ connectionString });
  const cli = fileURLToPath(new URL("./project-v2-board-data-repair.mjs", import.meta.url));
  const temp = await mkdtemp(path.join(tmpdir(), "pilo-board-repair-"));
  const workspaceId = "00000000-0000-0000-0000-000000000001";
  const actorUserId = "00000000-0000-0000-0000-000000000002";
  const configPath = path.join(temp, "config.json");
  const manifestPath = path.join(temp, "rollback.json");
  const noOpManifestPath = path.join(temp, "noop-rollback.json");

  function runCli(args) {
    return execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, BOARD_REPAIR_DATABASE_URL: connectionString }
    });
  }

  async function scalar(sql) {
    const result = await pool.query(sql);
    return Number(result.rows[0].count);
  }

  await test("transactional dry-run, apply, no-op, and rollback preserve audit rows", async () => {
    const oldHashOne = hashBoardIssueRequest({ boardId: "100", columnId: "1001", title: "One", body: "Body" });
    const oldHashTwo = hashBoardIssueRequest({
      boardId: "100", columnId: "1002", title: "Two", body: "Fallback body"
    });
    await pool.query(`
      DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE TABLE boards (
        id bigint PRIMARY KEY, workspace_id uuid NOT NULL, repository_id uuid, project_v2_id uuid,
        status_field_id uuid, name varchar(255) NOT NULL, last_sync_status text,
        last_synced_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE board_columns (
        id bigint PRIMARY KEY, board_id bigint NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        status_option_id uuid, status_option_github_id text, normalized_name text, name varchar(255) NOT NULL,
        position integer NOT NULL, color varchar(30), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        UNIQUE(id, board_id));
      CREATE TABLE pilo_issues (id bigint PRIMARY KEY, board_id bigint NOT NULL REFERENCES boards(id) ON DELETE CASCADE);
      CREATE TABLE workspace_board_settings (workspace_id uuid PRIMARY KEY, active_board_id bigint REFERENCES boards(id));
      CREATE TABLE meetings (id uuid PRIMARY KEY, workspace_id uuid NOT NULL);
      CREATE TABLE meeting_reports (id uuid PRIMARY KEY, meeting_id uuid NOT NULL REFERENCES meetings(id));
      CREATE TABLE meeting_report_action_items (id uuid PRIMARY KEY, meeting_report_id uuid NOT NULL REFERENCES meeting_reports(id), status text NOT NULL, title text NOT NULL DEFAULT 'Fallback title', description text NOT NULL DEFAULT 'Fallback body');
      CREATE TABLE meeting_report_action_item_deliveries (
        id uuid PRIMARY KEY, action_item_id uuid NOT NULL REFERENCES meeting_report_action_items(id),
        delivery_type text NOT NULL, status text NOT NULL, calendar_event_id bigint, pilo_issue_id bigint,
        target_resource_id text, draft_json jsonb NOT NULL, idempotency_key text NOT NULL, requested_by_user_id uuid,
        updated_at timestamptz DEFAULT now());
      CREATE TABLE board_issue_create_operations (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL, actor_user_id uuid NOT NULL, board_id bigint NOT NULL, column_id bigint NOT NULL,
        idempotency_key text NOT NULL, request_hash text NOT NULL, request_title text NOT NULL, request_body text,
        status text NOT NULL, completed_stage text NOT NULL, updated_at timestamptz DEFAULT now(),
        FOREIGN KEY(column_id, board_id) REFERENCES board_columns(id, board_id) ON DELETE CASCADE ON UPDATE CASCADE);

      INSERT INTO boards(id, workspace_id, name) VALUES
        (100, '${workspaceId}', 'legacy referenced'), (101, '${workspaceId}', 'legacy delete'),
        (200, '${workspaceId}', 'canonical one'), (301, '${workspaceId}', 'legacy delete two'),
        (300, '${workspaceId}', 'canonical two');
      INSERT INTO board_columns(id, board_id, status_option_github_id, name, position) VALUES
        (1001,100,'todo','Todo',0),(1002,100,NULL,'Unmapped',1),
        (1011,101,'todo','Todo',0),(2001,200,'todo','Todo',0),(2002,200,NULL,'Unmapped',1),
        (3011,301,'todo','Todo',0),(3001,300,'todo','Todo',0);
      INSERT INTO meetings VALUES ('10000000-0000-0000-0000-000000000001','${workspaceId}');
      INSERT INTO meeting_reports VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
      INSERT INTO meeting_report_action_items VALUES
        ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','DELIVERY_FAILED'),
        ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','DELIVERY_FAILED'),
        ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','APPROVED'),
        ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','DELIVERY_FAILED');
      INSERT INTO meeting_report_action_item_deliveries VALUES
        ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','pilo_issue','FAILED',NULL,NULL,NULL,
         '{"issue":{"boardId":"100","columnId":"1001","title":"One","body":"Body"},"keep":{"secret":"not-in-manifest","flag":true}}','key-one','${actorUserId}',now()),
        ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','pilo_issue','FAILED',NULL,NULL,NULL,
         '{"issue":{"boardId":"100","columnId":"1002","title":"Two"}}','key-two','${actorUserId}',now()),
        ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003','pilo_issue','COMPLETED',NULL,NULL,'77',
         '{"issue":{"boardId":"100","columnId":"1001","title":"Done","body":"Audit"}}','key-done','${actorUserId}',now()),
        ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004','calendar_event','FAILED',NULL,NULL,NULL,
         '{"event":{"title":"Calendar"}}','key-calendar','${actorUserId}',now());
      INSERT INTO board_issue_create_operations VALUES
        ('50000000-0000-0000-0000-000000000001','${workspaceId}','${actorUserId}',100,1001,'key-one','${oldHashOne}','One','Body','retryable','none',now()),
        ('50000000-0000-0000-0000-000000000002','${workspaceId}','${actorUserId}',100,1002,'key-two','${oldHashTwo}','Two','Fallback body','retryable','none',now()),
        ('50000000-0000-0000-0000-000000000003','${workspaceId}','${actorUserId}',100,1001,'key-done',repeat('c',64),'Done','Audit','succeeded','cache_persisted',now()),
        ('50000000-0000-0000-0000-000000000004','${workspaceId}','${actorUserId}',100,1001,'unrelated',repeat('d',64),'Other',NULL,'retryable','none',now());
    `);
    await writeFile(configPath, JSON.stringify({
      workspaceId,
      boardGroups: [
        { canonicalBoardId: "200", legacyBoardIds: ["100", "101"] },
        { canonicalBoardId: "300", legacyBoardIds: ["301"] }
      ],
      expected: { deliveryUpdates: 2, operationUpdates: 2, boardDeletes: 2 }
    }));

    const before = await pool.query("SELECT draft_json FROM meeting_report_action_item_deliveries ORDER BY id");
    const operationsBefore = await pool.query(`
      SELECT id, board_id, column_id, request_hash, status, completed_stage
      FROM board_issue_create_operations ORDER BY id
    `);
    const deletedColumnsBefore = await pool.query(`
      SELECT id, board_id, status_option_id, status_option_github_id,
             normalized_name, name, position, color, created_at, updated_at
      FROM board_columns WHERE id IN (1011,3011) ORDER BY id
    `);
    runCli(["--config", configPath]);
    const afterDryRun = await pool.query("SELECT draft_json FROM meeting_report_action_item_deliveries ORDER BY id");
    assert.deepEqual(afterDryRun.rows, before.rows);
    assert.equal(await scalar("SELECT count(*) FROM boards"), 5);

    const mismatch = JSON.parse(await readFile(configPath, "utf8"));
    mismatch.expected.operationUpdates = 3;
    await writeFile(configPath, JSON.stringify(mismatch));
    assert.throws(() => runCli(["--config", configPath, "--apply", "--backup-path", path.join(temp, "must-not-exist.json")]));
    assert.deepEqual((await pool.query("SELECT draft_json FROM meeting_report_action_item_deliveries ORDER BY id")).rows, before.rows);
    assert.equal(await scalar("SELECT count(*) FROM boards"), 5);
    mismatch.expected.operationUpdates = 2;
    await writeFile(configPath, JSON.stringify(mismatch));

    runCli(["--config", configPath, "--apply", "--backup-path", manifestPath]);
    assert.equal(await scalar("SELECT count(*) FROM boards"), 3);
    assert.equal(await scalar("SELECT count(*) FROM boards WHERE id IN (101,301)"), 0);
    assert.equal(await scalar("SELECT count(*) FROM board_columns WHERE id IN (1011,3011)"), 0);
    const repaired = await pool.query("SELECT draft_json #>> '{issue,boardId}' board_id, draft_json #>> '{issue,columnId}' column_id FROM meeting_report_action_item_deliveries WHERE status='FAILED' AND delivery_type='pilo_issue' ORDER BY id");
    assert.deepEqual(repaired.rows, [{ board_id: "200", column_id: "2001" }, { board_id: "200", column_id: "2002" }]);
    const preservedDraft = await pool.query("SELECT draft_json FROM meeting_report_action_item_deliveries WHERE id='40000000-0000-0000-0000-000000000001'");
    assert.deepEqual(preservedDraft.rows[0].draft_json.keep, { secret: "not-in-manifest", flag: true });
    const completedAfter = await pool.query("SELECT draft_json, target_resource_id, status FROM meeting_report_action_item_deliveries WHERE id='40000000-0000-0000-0000-000000000003'");
    assert.deepEqual(completedAfter.rows[0], { draft_json: before.rows[2].draft_json, target_resource_id: "77", status: "COMPLETED" });
    const manifestText = await readFile(manifestPath, "utf8");
    assert.doesNotMatch(manifestText, /not-in-manifest|\"title\"|\"body\"/);
    const manifest = JSON.parse(manifestText);
    assert.deepEqual(Object.keys(manifest.deliveries[0]).sort(), ["after", "before", "id"]);
    assert.deepEqual(manifest.deletedBoards.map((row) => [String(row.id), row.name]), [["101", "legacy delete"], ["301", "legacy delete two"]]);
    assert.deepEqual(manifest.deletedColumns.map((row) => String(row.id)), ["1011", "3011"]);
    const ops = await pool.query("SELECT id, board_id::text, column_id::text, request_hash, status, completed_stage FROM board_issue_create_operations ORDER BY id");
    assert.deepEqual(ops.rows.slice(0, 2).map(({ board_id, column_id }) => ({ board_id, column_id })),
      [{ board_id: "200", column_id: "2001" }, { board_id: "200", column_id: "2002" }]);
    assert.equal(ops.rows[2].board_id, "100");
    assert.equal(ops.rows[3].board_id, "100");
    assert.equal(ops.rows[0].request_hash, hashBoardIssueRequest({
      boardId: "200", columnId: "2001", title: "One", body: "Body"
    }));
    assert.equal(ops.rows[1].request_hash, hashBoardIssueRequest({
      boardId: "200", columnId: "2002", title: "Two", body: "Fallback body"
    }));

    const noOpConfig = JSON.parse(await readFile(configPath, "utf8"));
    noOpConfig.expected = { deliveryUpdates: 0, operationUpdates: 0, boardDeletes: 0 };
    await writeFile(configPath, JSON.stringify(noOpConfig));
    runCli(["--config", configPath, "--apply", "--backup-path", noOpManifestPath]);

    runCli(["--rollback", manifestPath]);
    assert.equal(await scalar("SELECT count(*) FROM boards"), 5);
    assert.deepEqual((await pool.query("SELECT id::text, name FROM boards WHERE id IN (101,301) ORDER BY id")).rows,
      [{ id: "101", name: "legacy delete" }, { id: "301", name: "legacy delete two" }]);
    assert.deepEqual((await pool.query("SELECT id::text, status_option_github_id, name FROM board_columns WHERE id IN (1011,3011) ORDER BY id")).rows,
      [{ id: "1011", status_option_github_id: "todo", name: "Todo" }, { id: "3011", status_option_github_id: "todo", name: "Todo" }]);
    const operationsAfterRollback = await pool.query(`
      SELECT id, board_id, column_id, request_hash, status, completed_stage
      FROM board_issue_create_operations ORDER BY id
    `);
    assert.deepEqual(operationsAfterRollback.rows, operationsBefore.rows);
    const deletedColumnsAfterRollback = await pool.query(`
      SELECT id, board_id, status_option_id, status_option_github_id,
             normalized_name, name, position, color, created_at, updated_at
      FROM board_columns WHERE id IN (1011,3011) ORDER BY id
    `);
    assert.deepEqual(deletedColumnsAfterRollback.rows, deletedColumnsBefore.rows);
    const restored = await pool.query("SELECT draft_json FROM meeting_report_action_item_deliveries ORDER BY id");
    assert.deepEqual(restored.rows, before.rows);
  });

  await pool.end();
  await rm(temp, { recursive: true, force: true });
}
