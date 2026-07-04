import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  getRoot() {
    return {
      service: "pilo-app-server",
      status: "ok"
    };
  }

  getHealth() {
    return {
      service: "pilo-app-server",
      status: "ok",
      scope: "api"
    };
  }
}
