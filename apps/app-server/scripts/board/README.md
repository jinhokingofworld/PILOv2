# Board operator scripts

## ProjectV2 Board data repair (#1252)

`project-v2-board-data-repair.mjs` repairs stale Meeting Pilo-Issue retries after a
ProjectV2 Board has been reselected. This is an explicit operational repair, not
an API, schema, or migration change.

The repair is **FAILED-only**. A delivery is eligible only when it is a
`pilo_issue` delivery in `FAILED` state, its Action Item is `DELIVERY_FAILED`,
and `pilo_issue_id`, `calendar_event_id`, and `target_resource_id` are all null.
Its uniquely linked Board operation must be `retryable` at `completed_stage =
'none'`. COMPLETED delivery history, Calendar deliveries, succeeded operations,
and unrelated operations are always preserved.

### Configuration

Generated configuration and rollback manifests contain operational identifiers.
Never commit them. Supply all IDs at operation time; the script has no generated
Workspace, Board, Column, ProjectV2, delivery, or operation IDs hardcoded.

```json
{
  "workspaceId": "<workspace UUID>",
  "boardGroups": [
    {
      "canonicalBoardId": "<current ProjectV2 Board ID>",
      "legacyBoardIds": ["<legacy Board ID>"]
    }
  ],
  "expected": {
    "deliveryUpdates": 2,
    "operationUpdates": 2,
    "boardDeletes": 0
  }
}
```

Columns map by `status_option_github_id`. Names are diagnostic only. A null
Status option maps only to one unique null-option Unmapped Column on each Board.
Duplicate or missing identities abort the transaction.

### Dry-run (default)

Set `BOARD_REPAIR_DATABASE_URL` through an approved secret channel and run:

```text
node apps/app-server/scripts/board/project-v2-board-data-repair.mjs --config <uncommitted-config.json>
```

Default mode uses a serializable transaction, locks the scoped rows, prints a
redacted ID/status/count report, and always rolls back. Any identity mismatch or
expected count mismatch aborts and rolls back. DB owner approval is required for
the dry-run, deletion candidates, backup, and rollback procedure before apply.

### Apply and rollback

Apply is deliberately double-gated:

```text
node .../project-v2-board-data-repair.mjs --config <config.json> --apply --backup-path <new-manifest.json>
```

The backup path must not exist. The script writes the rollback manifest with
owner-only permissions before mutation and refuses to commit unless the exact
delivery, operation, and Board counts match. Keep the manifest in an approved
encrypted location and never commit it.

Rollback is a separate command:

```text
node .../project-v2-board-data-repair.mjs --rollback <manifest.json>
```

Rollback validates the current repaired IDs and request hashes before restoring
the captured delivery JSON ID paths, retryable operation IDs/hashes, and deleted
reference-free Board/Column metadata. A mismatch aborts the entire rollback.

Legacy Boards with Pilo Issues, active settings, any Meeting draft history, or
Board operations are retained. In particular, successful operation and completed
delivery audit history is never moved merely to make a legacy Board deletable.
