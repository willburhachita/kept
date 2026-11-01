import { ConvexError } from "convex/values";

/** Backend error codes (see docs/08-BACKEND-API.md). */
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

const AUTH_MESSAGES: Record<string, string> = {
  InvalidAccountId: "No account with that email. Create one instead?",
  InvalidSecret: "That password doesn't match this email.",
  TooManyFailedAttempts: "Too many attempts. Wait a few minutes and try again.",
  AccountAlreadyExists: "An account with this email already exists. Sign in instead.",
};

function fromData(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "message" in data) return String((data as { message: unknown }).message);
  return null;
}

/** A human sentence for any error thrown by a Convex call. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof ConvexError) return fromData(e.data) ?? fallback;
  if (e instanceof Error) {
    for (const [key, msg] of Object.entries(AUTH_MESSAGES)) if (e.message.includes(key)) return msg;
    const m = /Uncaught (?:ConvexError|Error):\s*(.+?)(?:\n|\s+at\s|$)/.exec(e.message);
    if (m) return m[1];
    if (/network|fetch|connection/i.test(e.message)) return "Connection problem. Check your internet and retry.";
    return e.message.length < 160 ? e.message : fallback;
  }
  return fallback;
}

/** The backend error code, when there is one. */
export function errorCode(e: unknown): ErrorCode | null {
  if (e instanceof ConvexError && e.data && typeof e.data === "object" && "code" in e.data) {
    return (e.data as { code: ErrorCode }).code;
  }
  return null;
}

/** Extra fields on a ConvexError (retryAfterMs, paypalCode, issues, ...). */
export function errorData(e: unknown): Record<string, unknown> {
  return e instanceof ConvexError && e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {};
}
