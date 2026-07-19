import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../../common/api-error";
import type { PublicWorkspaceScreenShareSession } from "./screen-share.types";

export type ScreenShareAlreadyActiveDetails = {
  session: PublicWorkspaceScreenShareSession;
};

export function screenShareAlreadyActive(
  session?: PublicWorkspaceScreenShareSession
): ApiError<ScreenShareAlreadyActiveDetails> {
  return new ApiError(
    HttpStatus.CONFLICT,
    "SCREEN_SHARE_ALREADY_ACTIVE",
    "Screen share is already active",
    session === undefined ? undefined : { session }
  );
}

export function screenShareNotFound(): ApiError {
  return new ApiError(
    HttpStatus.NOT_FOUND,
    "SCREEN_SHARE_NOT_FOUND",
    "Screen share not found"
  );
}

export function serviceUnavailable(message: string): ApiError {
  return new ApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    "SERVICE_UNAVAILABLE",
    message
  );
}
