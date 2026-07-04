import { HttpException, HttpStatus } from "@nestjs/common";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND";

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: ApiErrorCode, message: string) {
    super(
      {
        success: false,
        error: {
          code,
          message
        }
      } satisfies ApiErrorResponse,
      status
    );
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message);
}

export function unauthorized(message: string): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
}

export function forbidden(message: string): ApiError {
  return new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
}

export function notFound(message: string): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
}
