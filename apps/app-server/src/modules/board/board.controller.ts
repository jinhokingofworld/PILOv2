import { Controller, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";

@Controller("workspaces/:workspaceId/boards")
@UseGuards(AuthGuard)
export class BoardController {}
