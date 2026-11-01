import { ConvexError } from "convex/values";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "VERIFICATION_FAILED"
  | "PAYMENT_FAILED"
  | "AI_FAILED"
  | "CONFIG_MISSING"
  | "CONFLICT";

export interface AppErrorData {
  code: ErrorCode;
  message: string;
  [key: string]: string | number | boolean | null | string[] | undefined;
}

/** Throw a structured, client-visible error. Clients read `error.data.code`. */
export function fail(code: ErrorCode, message: string, extra: Record<string, string | number | boolean | null | string[]> = {}): never {
  throw new ConvexError<AppErrorData>({ code, message, ...extra });
}

export function isAppError(e: unknown): e is ConvexError<AppErrorData> {
  return e instanceof ConvexError && typeof (e.data as AppErrorData)?.code === "string";
}

/** HTTP status for REST responses. */
export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "INVALID_ARGUMENT":
    case "VERIFICATION_FAILED":
      return 400;
    case "INVALID_STATE":
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "CONFIG_MISSING":
      return 503;
    default:
      return 502;
  }
}
