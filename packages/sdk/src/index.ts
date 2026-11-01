/**
 * @kept/sdk: typed client for the Kept REST API and agent API.
 * Zero dependencies beyond @kept/core; works anywhere `fetch` exists.
 */
import {
  hmacSha256,
  journalEntryHash,
  verifyReceipt,
  type ContractIR,
  type MandatePolicy,
  type MandateReport,
  type RenderedContract,
  type VerificationReport,
} from "@kept/core";

export type { ContractIR, MandatePolicy, MandateReport, RenderedContract, VerificationReport };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class KeptApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly path = "",
  ) {
    super(message);
    this.name = "KeptApiError";
  }
}

// ---------------------------------------------------------------------------
// Response types (mirroring the backend view models)
// ---------------------------------------------------------------------------

export type ContractStatus =
  | "draft" | "compiling" | "verifying" | "review" | "needs_attention" | "awaiting_funding"
  | "funding" | "active" | "settling" | "settled" | "frozen" | "cancelled";

export interface Ledger {
  principalCents: number;
  heldCents: number;
  releasedCents: number;
  refundedCents: number;
  feesCents: number;
  capturedCents: number;
  paidOutCents: number;
  refundExecutedCents: number;
  voidedCents: number;
}

export interface ContractView {
  _id: string;
  status: ContractStatus;
  version: number;
  prompt: string;
  myRole: "funder" | "payee" | null;
  isCreator: boolean;
  parties: Record<"funder" | "payee", { userId: string; displayName: string; email: string | null; hasPayoutEmail: boolean } | null>;
  ir: ContractIR | null;
  irHash: string | null;
  termsHash: string | null;
  feeBps: number;
  rendered: RenderedContract | null;
  verification: { ok: boolean; summary: string; irHash: string; report: VerificationReport; current: boolean } | null;
  approvals: { funder: boolean; payee: boolean };
  funding: {
    mode: "authorize" | "escrow";
    runtimeMode: "authorize" | "escrow";
    currency: string;
    authorizationCents: number;
    maxFeeCents: number;
    approveUrl: string | null;
    authorizedAt: number | null;
    honorEndsAt: number | null;
    expiresAt: number | null;
    capturedCents: number;
    captures: number;
    voided: { cents: number; at: number } | null;
  } | null;
  activatedAt: number | null;
  deadlines: { id: string; label: string; afterHours: number; at: number | null; passed: boolean }[];
  nextDeadline: { id: string; label: string; at: number | null } | null;
  ledger: Ledger;
  money: Record<"principal" | "held" | "released" | "refunded" | "fees", string> | null;
  frozen: { reason: string; at: number; by: string } | null;
  settledAt: number | null;
  nextActions: string[];
  serverTime: number;
}

export interface ContractSummary {
  _id: string;
  title: string;
  status: ContractStatus;
  myRole: "funder" | "payee" | null;
  principalCents: number | null;
  currency: string | null;
  heldCents: number;
  releasedCents: number;
  verified: boolean;
  counterpartyJoined: boolean;
  updatedAt: number;
}

export interface JournalEntry {
  stream?: string;
  seq: number;
  at: number;
  actor: string;
  type: string;
  data: unknown;
  hash: string;
  prevHash: string;
  sig: string;
  keyId: string;
  checkpoint: number | null;
}

export interface EvidenceItem {
  _id: string;
  slotId: string;
  slotLabel: string;
  criteria: string[];
  kind: "file" | "text" | "link";
  status: "checking" | "challenge_window" | "awaiting_funder" | "funder_rejected" | "in_arbitration" | "accepted" | "rejected";
  statusLabel: string;
  submittedAt: number;
  onTime: boolean;
  file: { url: string | null; fileName: string | null; contentType: string | null; size: number | null; sha256: string | null } | null;
  text: string | null;
  url: string | null;
  ai: { overall: "pass" | "fail" | "uncertain"; confidence: number; summary: string; criteria: { criterion: string; met: boolean; confidence: number; reason: string }[]; suspectedManipulation: boolean } | null;
  timer: { kind: string; endsAt: number | null; msRemaining: number | null } | null;
  canAccept: boolean;
  canReject: boolean;
  canChallenge: boolean;
  canDispute: boolean;
}

export interface SpendResult {
  spendId: string;
  status: "screening" | "needs_approval" | "executing" | "paid" | "denied" | "failed" | "cancelled";
  reasons: string[];
  amountCents: number;
  feeCents: number;
  amount: string;
  currency: string;
  merchantEmail: string;
  merchantName: string;
  description: string;
  remainingCents: number;
  createdAt: number;
  final: boolean;
}

export type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// HTTP core
// ---------------------------------------------------------------------------

interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

class Http {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly timeout: number;
  constructor(
    opts: ClientOptions,
    private readonly token: string,
  ) {
    if (!opts.baseUrl) throw new Error("baseUrl is required (https://<deployment>.convex.site)");
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.f = opts.fetch ?? fetch;
    this.timeout = opts.timeoutMs ?? 30_000;
  }

  async request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, auth = true): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, {
        method,
        headers: { ...(auth ? { authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as { name?: string })?.name === "AbortError";
      throw new KeptApiError(0, aborted ? "TIMEOUT" : "NETWORK", aborted ? `Request timed out after ${this.timeout} ms` : String((e as Error)?.message ?? e), {}, path);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: any = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const { code = `HTTP_${res.status}`, message = res.statusText || "Request failed", ...details } = json?.error ?? {};
      throw new KeptApiError(res.status, code, message, details, path);
    }
    return json as T;
  }
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Kept: the developer client (API key)
// ---------------------------------------------------------------------------

export class Kept {
  private readonly http: Http;
  private readonly f: typeof fetch;

  constructor(opts: ClientOptions & { apiKey: string }) {
    if (!opts.apiKey?.startsWith("sk_")) throw new Error("apiKey must be a Kept API key (sk_...)");
    this.http = new Http(opts, opts.apiKey);
    this.f = opts.fetch ?? fetch;
  }

  me() {
    return this.http.request<{ userId: string; email: string; displayName: string; payoutEmail: string | null; role: string }>("GET", "/v1/me");
  }

  /** Stateless verification (no key needed server-side). Also available offline via @kept/core. */
  verify(ir: unknown, feeBps?: number) {
    return this.http.request<{ valid: true; report: VerificationReport } | { valid: false; issues: unknown[] }>("POST", "/v1/verify", { ir, feeBps }, false);
  }

  readonly contracts = {
    create: (a: { prompt?: string; role: "funder" | "payee"; counterpartyEmail?: string; ir?: ContractIR; compile?: boolean }) =>
      this.http.request<{ contractId: string; inviteUrl: string; inviteToken: string; compiling: boolean }>("POST", "/v1/contracts", { prompt: "", ...a }),
    list: async () => (await this.http.request<{ data: ContractSummary[] }>("GET", "/v1/contracts")).data,
    get: (id: string) => this.http.request<ContractView>("GET", `/v1/contracts/${enc(id)}`),
    compile: (id: string) => this.http.request<{ started: true; poll: string }>("POST", `/v1/contracts/${enc(id)}/compile`),
    compileStatus: (id: string) => this.http.request<Json | null>("GET", `/v1/contracts/${enc(id)}/compile`),
    setTerms: (id: string, ir: ContractIR) => this.http.request<{ irHash: string }>("PUT", `/v1/contracts/${enc(id)}/terms`, { ir }),
    approve: (id: string, termsHash: string) => this.http.request<{ status: string }>("POST", `/v1/contracts/${enc(id)}/approve`, { termsHash }),
    fund: (id: string) => this.http.request<{ orderId: string; approveUrl: string }>("POST", `/v1/contracts/${enc(id)}/fund`),
    confirmFunding: (id: string) => this.http.request<{ status: string }>("POST", `/v1/contracts/${enc(id)}/fund/confirm`),
    cancel: (id: string) => this.http.request<Json>("POST", `/v1/contracts/${enc(id)}/cancel`),
    journal: async (id: string, limit = 200) => (await this.http.request<{ data: JournalEntry[] }>("GET", `/v1/contracts/${enc(id)}/journal?limit=${limit}`)).data,
    proof: (id: string) => this.http.request<Json>("GET", `/v1/contracts/${enc(id)}/proof`),
    uploadUrl: (id: string) => this.http.request<{ uploadUrl: string; maxBytes: number; allowedTypes: string[] }>("POST", `/v1/contracts/${enc(id)}/uploads`),
    submitEvidence: (id: string, e: { slotId: string; text?: string; url?: string; storageId?: string; fileName?: string }) =>
      this.http.request<{ evidenceId: string; status: string }>("POST", `/v1/contracts/${enc(id)}/evidence`, e),
    listEvidence: async (id: string) => (await this.http.request<{ data: EvidenceItem[] }>("GET", `/v1/contracts/${enc(id)}/evidence`)).data,
    /** Upload a file to storage and submit it as evidence in one call. */
    uploadEvidenceFile: async (id: string, slotId: string, file: Blob, contentType: string, fileName?: string) => {
      const { uploadUrl } = await this.contracts.uploadUrl(id);
      const res = await this.f(uploadUrl, { method: "POST", headers: { "content-type": contentType }, body: file });
      if (!res.ok) throw new KeptApiError(res.status, "UPLOAD_FAILED", `Upload failed with HTTP ${res.status}`);
      const { storageId } = (await res.json()) as { storageId: string };
      return this.contracts.submitEvidence(id, { slotId, storageId, fileName });
    },
  };

  readonly evidence = {
    accept: (evidenceId: string) => this.http.request<Json>("POST", `/v1/evidence/${enc(evidenceId)}/accept`),
    reject: (evidenceId: string, reason: string) => this.http.request<Json>("POST", `/v1/evidence/${enc(evidenceId)}/reject`, { reason }),
    challenge: (evidenceId: string, reason: string) => this.http.request<Json>("POST", `/v1/evidence/${enc(evidenceId)}/challenge`, { reason }),
    dispute: (evidenceId: string, reason: string) => this.http.request<Json>("POST", `/v1/evidence/${enc(evidenceId)}/dispute`, { reason }),
  };

  readonly invites = {
    accept: (token: string) => this.http.request<{ contractId: string }>("POST", "/v1/invites/accept", { token }),
  };

  readonly mandates = {
    create: (policy: MandatePolicy, prompt?: string) => this.http.request<{ mandateId: string; verified: boolean; report: MandateReport }>("POST", "/v1/mandates", { policy, prompt }),
    list: async () => (await this.http.request<{ data: Json[] }>("GET", "/v1/mandates")).data,
    get: (id: string) => this.http.request<Json>("GET", `/v1/mandates/${enc(id)}`),
    fund: (id: string) => this.http.request<{ orderId: string; approveUrl: string }>("POST", `/v1/mandates/${enc(id)}/fund`),
    confirmFunding: (id: string) => this.http.request<{ status: string }>("POST", `/v1/mandates/${enc(id)}/fund/confirm`),
    issueToken: (id: string, label: string, expiresInHours?: number) =>
      this.http.request<{ tokenId: string; token: string; prefix: string; expiresAt: number; mcpUrl: string; agentApiUrl: string }>("POST", `/v1/mandates/${enc(id)}/tokens`, { label, expiresInHours }),
    revoke: (id: string) => this.http.request<{ status: string }>("POST", `/v1/mandates/${enc(id)}/revoke`),
    spends: async (id: string) => (await this.http.request<{ data: Json[] }>("GET", `/v1/mandates/${enc(id)}/spends`)).data,
  };

  readonly spends = {
    decide: (spendId: string, approve: boolean, reason?: string) => this.http.request<{ status: string }>("POST", `/v1/spends/${enc(spendId)}/decide`, { approve, reason }),
  };

  readonly webhooks = {
    createEndpoint: (url: string, events?: string[]) => this.http.request<{ endpointId: string; url: string; events: string[]; secret: string }>("POST", "/v1/webhooks/endpoints", { url, events }),
  };

  readonly transparency = {
    checkpoints: (limit = 20) => this.http.request<Json>("GET", `/v1/transparency/checkpoints?limit=${limit}`, undefined, false),
    proof: (entryHash: string) => this.http.request<Json>("GET", `/v1/transparency/proof/${enc(entryHash)}`, undefined, false),
  };
}

// ---------------------------------------------------------------------------
// KeptAgent: for AI agents holding a mandate token
// ---------------------------------------------------------------------------

export class KeptAgent {
  private readonly http: Http;
  constructor(opts: ClientOptions & { mandateToken: string }) {
    if (!opts.mandateToken?.startsWith("mt_")) throw new Error("mandateToken must be a mandate token (mt_...)");
    this.http = new Http(opts, opts.mandateToken);
  }
  getMandate() {
    return this.http.request<Json>("GET", "/agent/v1/mandate");
  }
  requestSpend(s: { merchantEmail: string; merchantName: string; amountCents: number; currency?: string; description: string; idempotencyKey?: string }) {
    return this.http.request<SpendResult>("POST", "/agent/v1/spends", { currency: "USD", idempotencyKey: crypto.randomUUID(), ...s });
  }
  getSpend(spendId: string) {
    return this.http.request<SpendResult>("GET", `/agent/v1/spends/${enc(spendId)}`);
  }
}

// ---------------------------------------------------------------------------
// Webhooks + receipts
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  type: string;
  timestamp: string;
  data: JournalEntry & { stream: string };
}

function b64ToBytes(b64: string): Uint8Array {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function header(h: HeaderSource, name: string): string | null {
  if (typeof (h as Headers).get === "function") return (h as Headers).get(name);
  const rec = h as Record<string, string | string[] | undefined>;
  const v = rec[name] ?? rec[name.toLowerCase()] ?? Object.entries(rec).find(([k]) => k.toLowerCase() === name)?.[1];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Verify a Kept webhook (Standard Webhooks signing): returns the parsed
 * event or throws. Pass the raw request body, exactly as received.
 */
export function verifyWebhook(opts: { secret: string; headers: HeaderSource; body: string; toleranceSec?: number; nowMs?: number }): WebhookEvent {
  const id = header(opts.headers, "webhook-id");
  const ts = header(opts.headers, "webhook-timestamp");
  const sigs = header(opts.headers, "webhook-signature");
  if (!id || !ts || !sigs) throw new Error("Missing webhook-id, webhook-timestamp or webhook-signature header.");
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (!/^\d+$/.test(ts) || Math.abs(now - Number(ts)) > (opts.toleranceSec ?? 300)) throw new Error("Webhook timestamp is outside the tolerance window.");
  const key = b64ToBytes(opts.secret.replace(/^whsec_/, ""));
  const expected = bytesToB64(hmacSha256(key, `${id}.${ts}.${opts.body}`));
  const ok = sigs.split(" ").some((part) => {
    const [version, sig] = part.split(",", 2);
    return version === "v1" && typeof sig === "string" && safeEqual(sig, expected);
  });
  if (!ok) throw new Error("Webhook signature does not match.");
  return JSON.parse(opts.body) as WebhookEvent;
}

/** Check a journal entry (from a webhook, the journal API or a proof pack) against the published key. */
export function verifyJournalEntry(entry: JournalEntry & { stream: string }, publicKeyHex: string): boolean {
  const hash = journalEntryHash({ stream: entry.stream, seq: entry.seq, at: entry.at, actor: entry.actor, type: entry.type, data: entry.data, prevHash: entry.prevHash });
  return hash === entry.hash && verifyReceipt(entry.hash, entry.sig, publicKeyHex);
}
