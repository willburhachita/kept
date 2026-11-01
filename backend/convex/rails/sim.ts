/**
 * Deterministic simulation rail. No network, no state: every id is derived
 * from the request id, and amounts travel inside the order id. Used by the
 * test suite and for offline demos (PAYMENT_RAIL=sim). Never selected
 * implicitly.
 *
 * Failure injection for tests: SIM_FAIL="capture,payout" makes those
 * operations fail permanently; SIM_FAIL_RETRYABLE="payout" fails them
 * with a retryable error.
 */
import { sha256Hex } from "@kept/core";
import { env } from "../lib/env";
import { RailError, type PaymentRail } from "./types";

const id = (prefix: string, seed: string) => `${prefix}-${sha256Hex(seed).slice(0, 16).toUpperCase()}`;

function maybeFail(op: string) {
  const hard = (process.env.SIM_FAIL ?? "").split(",").map((s) => s.trim());
  const soft = (process.env.SIM_FAIL_RETRYABLE ?? "").split(",").map((s) => s.trim());
  if (hard.includes(op)) throw new RailError(`sim: ${op} declined`, { retryable: false, code: "SIM_DECLINED", status: 422 });
  if (soft.includes(op)) throw new RailError(`sim: ${op} temporarily unavailable`, { retryable: true, code: "SIM_UNAVAILABLE", status: 503 });
}

function parseOrder(orderId: string) {
  const m = /^SIMORD_(\d+)_([A-Z]{3})_([A-Za-z0-9-]+)_[0-9A-F]+$/.exec(orderId);
  if (!m) throw new RailError("sim: unknown order", { retryable: false, code: "RESOURCE_NOT_FOUND", status: 404 });
  return { amountCents: Number(m[1]), currency: m[2], referenceId: m[3] };
}

export const simRail: PaymentRail = {
  name: "sim",
  async createOrder(i) {
    maybeFail("order");
    const orderId = `SIMORD_${i.amountCents}_${i.currency}_${i.referenceId}_${sha256Hex(i.requestId).slice(0, 10).toUpperCase()}`;
    const approveUrl = `${env.siteUrl()}/sim/approve?token=${encodeURIComponent(orderId)}&return=${encodeURIComponent(i.returnUrl)}&cancel=${encodeURIComponent(i.cancelUrl)}`;
    return { orderId, approveUrl, status: "PAYER_ACTION_REQUIRED" };
  },
  async getOrder(orderId) {
    const o = parseOrder(orderId);
    return { orderId, status: "APPROVED", ...o };
  },
  async authorizeOrder(orderId, requestId) {
    maybeFail("authorize");
    const o = parseOrder(orderId);
    return {
      authorizationId: id("SIMAUTH", requestId),
      status: "CREATED",
      amountCents: o.amountCents,
      currency: o.currency,
      expiresAt: Date.now() + 29 * 24 * 3_600_000,
    };
  },
  async captureOrder(orderId, requestId) {
    maybeFail("capture");
    const o = parseOrder(orderId);
    return { captureId: id("SIMCAP", requestId), status: "COMPLETED", amountCents: o.amountCents, currency: o.currency };
  },
  async captureAuthorization(i) {
    maybeFail("capture");
    return { captureId: id("SIMCAP", i.requestId), status: "COMPLETED", amountCents: i.amountCents, currency: i.currency };
  },
  async reauthorize(i) {
    maybeFail("reauthorize");
    return {
      authorizationId: id("SIMAUTH", i.requestId),
      status: "CREATED",
      amountCents: i.amountCents,
      currency: i.currency,
      expiresAt: Date.now() + 29 * 24 * 3_600_000,
    };
  },
  async voidAuthorization() {
    maybeFail("void");
    return { status: "VOIDED" };
  },
  async refundCapture(i) {
    maybeFail("refund");
    return { refundId: id("SIMREF", i.requestId), status: "COMPLETED" };
  },
  async payout(i) {
    maybeFail("payout");
    return { payoutBatchId: id("SIMPO", i.senderBatchId), status: "SUCCESS" };
  },
  async getPayoutBatch() {
    return { status: "SUCCESS", items: [] };
  },
  async getCapture(captureId) {
    return { captureId, status: "COMPLETED", amountCents: 0, currency: "USD" };
  },
  async verifyWebhook() {
    return false;
  },
};
