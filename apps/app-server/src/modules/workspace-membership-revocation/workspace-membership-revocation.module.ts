import { Module } from "@nestjs/common";
import { WorkspaceMembershipRevocationPublisherService } from "./workspace-membership-revocation-publisher.service";

@Module({
  providers: [WorkspaceMembershipRevocationPublisherService],
  exports: [WorkspaceMembershipRevocationPublisherService]
})
export class WorkspaceMembershipRevocationModule {}
