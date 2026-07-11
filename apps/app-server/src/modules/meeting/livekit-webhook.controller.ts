import { Body, Controller, Headers, HttpCode, Post, RawBody } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import {
  LiveKitWebhookDeliveryPayload,
  LiveKitWebhookService
} from "./livekit-webhook.service";

@Controller("livekit")
export class LiveKitWebhookController {
  constructor(private readonly liveKitWebhookService: LiveKitWebhookService) {}

  @Post("webhooks")
  @HttpCode(200)
  async receiveWebhook(
    @Headers("authorization") authorization: string | undefined,
    @RawBody() rawBody: Buffer | undefined,
    @Body() _body: unknown
  ): Promise<ApiSuccessResponse<LiveKitWebhookDeliveryPayload>> {
    const result = await this.liveKitWebhookService.receiveWebhook(
      rawBody,
      authorization
    );
    return apiResponse(result);
  }
}
