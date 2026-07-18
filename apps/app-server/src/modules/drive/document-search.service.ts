import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_EXCERPT_LENGTH = 500;
const MAX_HEADING_PATH_LENGTH = 200;
const MAX_TITLE_LENGTH = 160;

export interface DocumentSearchInput {
  query: string;
  topK: number;
}

export interface DocumentSearchResult {
  documentId: string;
  title: string;
  headingPath: string;
  excerpt: string;
  score: number;
}

interface DocumentSearchRow {
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

    const embedding = await this.embed(input.query);
    const vector = `[${embedding.join(",")}]`;
    const rows = await this.database.query<DocumentSearchRow>(
      `
        WITH ranked_chunks AS (
          SELECT
            document.id AS document_id,
            item.name AS title,
            chunk.heading_path,
            chunk.chunk_text,
            1 - (chunk.embedding <=> $2::extensions.vector) AS score,
            row_number() OVER (
              PARTITION BY document.id
              ORDER BY chunk.embedding <=> $2::extensions.vector
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
        SELECT document_id, title, heading_path, chunk_text, score
        FROM ranked_chunks
        WHERE document_rank = 1
        ORDER BY score DESC, document_id ASC
        LIMIT $3
      `,
      [workspaceId, vector, input.topK]
    );

    return rows.map((row) => ({
      documentId: row.document_id,
      title: this.boundText(row.title, MAX_TITLE_LENGTH),
      headingPath: this.boundText(row.heading_path, MAX_HEADING_PATH_LENGTH),
      excerpt: this.boundText(row.chunk_text, MAX_EXCERPT_LENGTH),
      score: Number(row.score)
    }));
  }

  private async embed(query: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: query,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float"
      })
    });
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: unknown }>;
    };
    const vector = payload.data?.[0]?.embedding;

    if (
      !response.ok ||
      !Array.isArray(vector) ||
      vector.length !== EMBEDDING_DIMENSIONS ||
      vector.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error("Document search query embedding failed");
    }

    return vector;
  }

  private boundText(value: string, maxLength: number): string {
    const text = value.trim().replace(/\s+/g, " ");
    return text.length <= maxLength
      ? text
      : `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
  }
}
