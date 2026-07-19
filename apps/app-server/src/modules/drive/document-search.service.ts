import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { embedGroundingQuery } from "../agent/grounding/query-embedding";
import {
  driveRagMinimumSimilarity,
  passesRelevanceThreshold
} from "../agent/grounding/relevance-policy";
import { WorkspaceService } from "../workspace/workspace.service";

const MAX_EXCERPT_LENGTH = 500;
const MAX_HEADING_PATH_LENGTH = 200;
const MAX_TITLE_LENGTH = 160;

export interface DocumentSearchInput {
  query: string;
  topK: number;
}

export interface DocumentSearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  headingPath: string;
  excerpt: string;
  score: number;
}

interface DocumentSearchRow {
  chunk_id: string;
  document_id: string;
  title: string;
  heading_path: string;
  chunk_text: string;
  score: number | string;
}

@Injectable()
export class DocumentSearchService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async search(
    currentUserId: string,
    workspaceId: string,
    input: DocumentSearchInput
  ): Promise<DocumentSearchResult[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const embedding = await embedGroundingQuery(input.query);
    const vector = `[${embedding.join(",")}]`;
    const rows = await this.database.query<DocumentSearchRow>(
      `
        WITH ranked_chunks AS (
          SELECT
            chunk.id AS chunk_id,
            document.id AS document_id,
            item.name AS title,
            chunk.heading_path,
            chunk.chunk_text,
            1 - (chunk.embedding OPERATOR(extensions.<=>) $2::extensions.vector) AS score,
            row_number() OVER (
              PARTITION BY document.id
              ORDER BY chunk.embedding OPERATOR(extensions.<=>) $2::extensions.vector
            ) AS document_rank
          FROM document_embedding_chunks AS chunk
          JOIN documents AS document
            ON document.id = chunk.document_id
            AND document.workspace_id = chunk.workspace_id
          JOIN drive_items AS item
            ON item.id = document.drive_item_id
            AND item.workspace_id = document.workspace_id
          WHERE chunk.workspace_id = $1::uuid
            AND document.latest_snapshot_id = chunk.snapshot_id
            AND document.deleted_at IS NULL
            AND item.deleted_at IS NULL
            AND item.item_type = 'document'
        )
        SELECT chunk_id, document_id, title, heading_path, chunk_text, score
        FROM ranked_chunks
        WHERE document_rank = 1
        ORDER BY score DESC, document_id ASC
        LIMIT $3
      `,
      [workspaceId, vector, input.topK]
    );

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      title: this.boundText(row.title, MAX_TITLE_LENGTH),
      headingPath: this.boundText(row.heading_path, MAX_HEADING_PATH_LENGTH),
      excerpt: this.boundText(row.chunk_text, MAX_EXCERPT_LENGTH),
      score: Number(row.score)
    })).filter((result) =>
      passesRelevanceThreshold(result.score, driveRagMinimumSimilarity())
    );
  }

  async loadAuthorizedSources(
    currentUserId: string,
    workspaceId: string,
    sourceRefs: string[]
  ): Promise<DocumentGroundingSource[]> {
    if (sourceRefs.length === 0) return [];
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const chunkIds = [...new Set(sourceRefs.flatMap((sourceRef) => {
      const match = /^drive_chunk:([0-9a-f-]+)$/i.exec(sourceRef);
      return match && UUID.test(match[1]) ? [match[1]] : [];
    }))];
    if (chunkIds.length === 0) return [];
    const rows = await this.database.query<DocumentSearchRow>(`
      SELECT chunk.id AS chunk_id, document.id AS document_id, item.name AS title,
        chunk.heading_path, chunk.chunk_text, 0 AS score
      FROM document_embedding_chunks chunk
      JOIN documents document
        ON document.id = chunk.document_id AND document.workspace_id = chunk.workspace_id
      JOIN drive_items item
        ON item.id = document.drive_item_id AND item.workspace_id = document.workspace_id
      WHERE chunk.workspace_id = $1::uuid
        AND chunk.id = ANY($2::uuid[])
        AND document.latest_snapshot_id = chunk.snapshot_id
        AND document.deleted_at IS NULL
        AND item.deleted_at IS NULL
        AND item.item_type = 'document'
    `, [workspaceId, chunkIds]);
    const byRef = new Map(rows.map((row) => [`drive_chunk:${row.chunk_id}`, {
      sourceRef: `drive_chunk:${row.chunk_id}`,
      documentId: row.document_id,
      title: this.boundText(row.title, MAX_TITLE_LENGTH),
      headingPath: this.boundText(row.heading_path, MAX_HEADING_PATH_LENGTH),
      excerpt: this.boundText(row.chunk_text, MAX_EXCERPT_LENGTH)
    }]));
    return sourceRefs.flatMap((sourceRef) => {
      const source = byRef.get(sourceRef);
      return source ? [source] : [];
    });
  }

  private boundText(value: string, maxLength: number): string {
    const text = value.trim().replace(/\s+/g, " ");
    return text.length <= maxLength
      ? text
      : `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DocumentGroundingSource {
  sourceRef: string;
  documentId: string;
  title: string;
  headingPath: string;
  excerpt: string;
}
