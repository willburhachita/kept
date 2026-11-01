/**
 * The payment rail interface. PayPal is the real implementation; the sim
 * rail is a deterministic stand-in for tests and offline demos.
 */

export class RailError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  readonly status: number | undefined;
  readonly details: unknown;
  constructor(message: string, opts: { retryable: boolean; code: string; status?: number; details?: unknown }) {
    super(message);
    this.name = "RailError";
    this.retryable = opts.retryable;
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

export function toRailError(e: unknown): RailError {
  if (e instanceof RailError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new RailError(message, { retryable: true, code: "UNEXPECTED" });
}

export interface CreateOrderInput {
  intent: "AUTHORIZE" | "CAPTURE";
  amountCents: number;
  currency: string;
  referenceId: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  brandName: string;
  requestId: string;
}

export interface OrderCreated {
  orderId: string;
  approveUrl: string;
  status: string;
}

export interface OrderInfo {
  orderId: string;
  status: string;
  amountCents: number;
  currency: string;
  referenceId: string | null;
}

export interface AuthorizationResult {
  authorizationId: string;
  status: string;
  amountCents: number;
  currency: string;
  /** ms since epoch, when PayPal reports it. */
  expiresAt: number | null;
}

export interface CaptureResult {
  captureId: string;
  status: string;
  amountCents: number;
  currency: string;
}

export interface PayoutResult {
  payoutBatchId: string;
  status: string;
}

export interface PaymentRail {
  readonly name: "paypal" | "sim";
  createOrder(input: CreateOrderInput): Promise<OrderCreated>;
  getOrder(orderId: string): Promise<OrderInfo>;
  authorizeOrder(orderId: string, requestId: string): Promise<AuthorizationResult>;
  captureOrder(orderId: string, requestId: string): Promise<CaptureResult>;
  captureAuthorization(input: {
    authorizationId: string;
    amountCents: number;
    currency: string;
    finalCapture: boolean;
    invoiceId: string;
    noteToPayer?: string;
    requestId: string;
  }): Promise<CaptureResult>;
  reauthorize(input: { authorizationId: string; amountCents: number; currency: string; requestId: string }): Promise<AuthorizationResult>;
  voidAuthorization(input: { authorizationId: string; requestId: string }): Promise<{ status: string }>;
  refundCapture(input: {
    captureId: string;
    amountCents: number;
    currency: string;
    note?: string;
    invoiceId?: string;
    requestId: string;
  }): Promise<{ refundId: string; status: string }>;
  payout(input: {
    senderBatchId: string;
    senderItemId: string;
    receiverEmail: string;
    amountCents: number;
    currency: string;
    note: string;
    subject: string;
    requestId: string;
  }): Promise<PayoutResult>;
  getPayoutBatch(payoutBatchId: string): Promise<{ status: string; items: { payoutItemId: string; status: string }[] }>;
  getCapture(captureId: string): Promise<CaptureResult>;
  verifyWebhook(headers: Record<string, string | null>, event: unknown): Promise<boolean>;
}
