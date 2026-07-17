import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { ChatController } from "./chat.controller";
import { ChatPublisherService } from "./chat-publisher.service";
import { ChatService } from "./chat.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [ChatController],
  providers: [ChatPublisherService, ChatService],
  exports: [ChatService]
})
export class ChatModule {}
