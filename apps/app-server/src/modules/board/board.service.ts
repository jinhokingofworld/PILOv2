import { Injectable } from "@nestjs/common";
import { BoardHydrationService } from "./board-hydration.service";
import type { CreateBoardResult } from "./types";

export interface BoardModuleInfo {
  domain: "board";
  apiContract: "docs/api/board-api.md";
}

@Injectable()
export class BoardService {
  constructor(private readonly boardHydrationService: BoardHydrationService) {}

  getModuleInfo(): BoardModuleInfo {
    return {
      domain: "board",
      apiContract: "docs/api/board-api.md"
    };
  }

  async createBoard(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<CreateBoardResult> {
    return this.boardHydrationService.createBoard(currentUserId, workspaceId, body);
  }
}
