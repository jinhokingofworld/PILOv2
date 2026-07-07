import { HttpException, HttpStatus } from "@nestjs/common";

type BoardWriteErrorCode = "CONFLICT" | "BAD_GATEWAY";

function boardWriteError(
  status: HttpStatus,
  code: BoardWriteErrorCode,
  message: string
): HttpException {
  return new HttpException(
    {
      success: false,
      error: {
        code,
        message
      }
    },
    status
  );
}

export function boardConflict(message: string): HttpException {
  return boardWriteError(HttpStatus.CONFLICT, "CONFLICT", message);
}

export function boardBadGateway(message: string): HttpException {
  return boardWriteError(HttpStatus.BAD_GATEWAY, "BAD_GATEWAY", message);
}
