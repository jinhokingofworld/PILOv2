import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceMembershipRevocationOutboxService } from "./workspace-membership-revocation-outbox.service";
import { WorkspaceMembershipRevocationPublisherService } from "./workspace-membership-revocation-publisher.service";

@Module({
  imports: [DatabaseModule],
  providers: [
    WorkspaceMembershipRevocationPublisherService,
    WorkspaceMembershipRevocationOutboxService
  ],
  exports: [WorkspaceMembershipRevocationOutboxService]
})
export class WorkspaceMembershipRevocationModule {}
