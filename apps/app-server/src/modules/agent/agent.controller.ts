import { Controller, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";

@Controller("workspaces/:workspaceId/agent")
@UseGuards(AuthGuard)
export class AgentController {}
