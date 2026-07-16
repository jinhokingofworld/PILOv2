import { Injectable } from "@nestjs/common";
import { BoardService } from "../../board/board.service";
import type {
  BoardDetailPayload,
  BoardPayload,
  BoardRepositoryPayload,
  BoardProjectPayload
} from "../../board/types";

export interface BoardContextSelector {
  boardName: string | null;
  repositoryFullName: string | null;
}

export interface ResolvedBoardContext {
  id: string;
  name: string;
  repository: BoardRepositoryPayload;
  project: BoardProjectPayload;
}

export interface BoardContextCandidate {
  name: string;
  repositoryFullName: string;
}

export type BoardContextResolution =
  | {
      kind: "selected";
      source: "explicit" | "active" | "single";
      board: ResolvedBoardContext;
    }
  | {
      kind: "needs_clarification";
      reason: "board_not_found" | "board_ambiguous";
      candidates: BoardContextCandidate[];
      totalCandidates: number;
    };

const MAX_BOARD_CANDIDATES = 5;

@Injectable()
export class BoardContextResolverService {
  constructor(private readonly boardService: BoardService) {}

  async resolve(
    currentUserId: string,
    workspaceId: string,
    selector: BoardContextSelector
  ): Promise<BoardContextResolution> {
    if (selector.boardName || selector.repositoryFullName) {
      return this.resolveExplicit(currentUserId, workspaceId, selector);
    }

    const active = await this.boardService.getActiveBoardSource(
      currentUserId,
      workspaceId
    );
    if (active) {
      const board = await this.boardService.getBoard(
        currentUserId,
        workspaceId,
        active.boardId
      );
      return {
        kind: "selected",
        source: "active",
        board: this.toResolvedBoard(board)
      };
    }

    const boards = await this.listAllBoards(currentUserId, workspaceId);
    if (boards.length === 1) {
      return {
        kind: "selected",
        source: "single",
        board: this.toResolvedBoard(boards[0])
      };
    }

    return this.toClarification(boards);
  }

  private async resolveExplicit(
    currentUserId: string,
    workspaceId: string,
    selector: BoardContextSelector
  ): Promise<BoardContextResolution> {
    const boards = await this.listAllBoards(currentUserId, workspaceId);
    const normalizedBoardName = selector.boardName
      ? this.normalize(selector.boardName)
      : null;
    const normalizedRepository = selector.repositoryFullName
      ? this.normalize(selector.repositoryFullName)
      : null;
    const matches = boards.filter((board) => {
      if (
        normalizedBoardName &&
        this.normalize(board.name) !== normalizedBoardName
      ) {
        return false;
      }
      if (
        normalizedRepository &&
        this.normalize(board.repository.fullName) !== normalizedRepository
      ) {
        return false;
      }
      return true;
    });

    if (matches.length === 1) {
      return {
        kind: "selected",
        source: "explicit",
        board: this.toResolvedBoard(matches[0])
      };
    }

    return this.toClarification(matches);
  }

  private async listAllBoards(
    currentUserId: string,
    workspaceId: string
  ): Promise<BoardPayload[]> {
    const first = await this.boardService.listBoards(
      currentUserId,
      workspaceId,
      { page: 1, limit: 100 }
    );
    const boards = [...first.data];
    const pageCount = Math.ceil(first.meta.total / 100);

    for (let page = 2; page <= pageCount; page += 1) {
      const next = await this.boardService.listBoards(
        currentUserId,
        workspaceId,
        { page, limit: 100 }
      );
      boards.push(...next.data);
    }

    return boards;
  }

  private toClarification(boards: BoardPayload[]): BoardContextResolution {
    return {
      kind: "needs_clarification",
      reason: boards.length === 0 ? "board_not_found" : "board_ambiguous",
      candidates: boards
        .slice(0, MAX_BOARD_CANDIDATES)
        .map((board) => ({
          name: board.name,
          repositoryFullName: board.repository.fullName
        })),
      totalCandidates: boards.length
    };
  }

  private toResolvedBoard(
    board: BoardPayload | BoardDetailPayload
  ): ResolvedBoardContext {
    return {
      id: board.id,
      name: board.name,
      repository: board.repository,
      project: board.project
    };
  }

  private normalize(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  }
}
