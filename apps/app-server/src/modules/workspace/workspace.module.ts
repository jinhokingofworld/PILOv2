import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceMembershipRevocationModule } from "../workspace-membership-revocation/workspace-membership-revocation.module";
import {
  CurrentUserWorkspaceInvitationController,
  WorkspaceController,
  WorkspaceInvitationController
} from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    WorkspaceMembershipRevocationModule
  ],
  controllers: [
    WorkspaceController,
    CurrentUserWorkspaceInvitationController,
    WorkspaceInvitationController
  ],
  providers: [WorkspaceService],
  exports: [WorkspaceService]
})
export class WorkspaceModule {}
