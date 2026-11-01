/** Display metadata for every status the backend can return. One place, used everywhere. */
export type Tone = "neutral" | "ink" | "blue" | "ok" | "warn" | "bad";

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** One line: what is happening and who acts next. */
  hint: string;
  /** Pulsing dot: something is in motion right now. */
  live?: boolean;
}

export const CONTRACT_STATUS: Record<string, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral", hint: "Describe the deal, then let Kept write and prove the rules." },
  compiling: { label: "Writing rules", tone: "blue", hint: "Claude is turning the deal into promises and rules.", live: true },
  verifying: { label: "Proving", tone: "blue", hint: "The verifier is checking every possible outcome.", live: true },
  review: { label: "In review", tone: "warn", hint: "Both sides approve the exact proved terms." },
  needs_attention: { label: "Needs attention", tone: "bad", hint: "The rules could not be proved. Edit the deal or answer the questions." },
  awaiting_funding: { label: "Ready to fund", tone: "warn", hint: "The payer puts the money on hold with PayPal." },
  funding: { label: "Funding", tone: "blue", hint: "Waiting for the PayPal approval to come back.", live: true },
  active: { label: "Live", tone: "ok", hint: "The money is held. It moves only by the proved rules.", live: true },
  settling: { label: "Settling", tone: "blue", hint: "PayPal is executing the final payments.", live: true },
  settled: { label: "Settled", tone: "ink", hint: "Every cent went where the rules said. Receipts are signed." },
  frozen: { label: "Frozen", tone: "bad", hint: "Money is paused while an arbiter reviews a problem." },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "Cancelled before any money moved." },
};

export const MANDATE_STATUS: Record<string, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral", hint: "The policy did not pass verification yet." },
  awaiting_funding: { label: "Ready to fund", tone: "warn", hint: "Put the budget on hold with PayPal to switch the agent on." },
  funding: { label: "Funding", tone: "blue", hint: "Waiting for the PayPal approval.", live: true },
  active: { label: "Live", tone: "ok", hint: "Agents can spend inside the policy.", live: true },
  closing: { label: "Closing", tone: "blue", hint: "Releasing the unused budget back to you.", live: true },
  closed: { label: "Closed", tone: "ink", hint: "Closed. The unused hold was released." },
  revoked: { label: "Revoked", tone: "neutral", hint: "Revoked before it was funded." },
  frozen: { label: "Frozen", tone: "bad", hint: "Paused for review." },
};

export const SPEND_STATUS: Record<string, StatusMeta> = {
  screening: { label: "Screening", tone: "blue", hint: "Checking the purchase against your policy.", live: true },
  needs_approval: { label: "Needs you", tone: "warn", hint: "Above your approval threshold: approve or decline." },
  executing: { label: "Paying", tone: "blue", hint: "Capturing and paying the merchant on PayPal.", live: true },
  paid: { label: "Paid", tone: "ok", hint: "Paid to the merchant." },
  denied: { label: "Denied", tone: "bad", hint: "Blocked by the policy." },
  failed: { label: "Failed", tone: "bad", hint: "PayPal could not complete it; nothing was charged for it." },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "Declined or cancelled." },
};

export const EVIDENCE_STATUS: Record<string, StatusMeta> = {
  checking: { label: "AI checking", tone: "blue", hint: "The AI examiner is checking it against the criteria.", live: true },
  challenge_window: { label: "Challenge window", tone: "warn", hint: "Passed the AI check; the payer can still object." },
  awaiting_funder: { label: "Payer reviewing", tone: "warn", hint: "Waiting for the payer to accept or reject." },
  funder_rejected: { label: "Rejected", tone: "bad", hint: "The payer rejected it; the payee can dispute." },
  in_arbitration: { label: "With arbiter", tone: "blue", hint: "A neutral arbiter is deciding." },
  accepted: { label: "Accepted", tone: "ok", hint: "Accepted. The rules release the money." },
  rejected: { label: "Rejected", tone: "bad", hint: "Final: rejected." },
};

const UNKNOWN: StatusMeta = { label: "Unknown", tone: "neutral", hint: "" };

export function contractStatus(s: string): StatusMeta {
  return CONTRACT_STATUS[s] ?? { ...UNKNOWN, label: s };
}
export function mandateStatus(s: string): StatusMeta {
  return MANDATE_STATUS[s] ?? { ...UNKNOWN, label: s };
}
export function spendStatus(s: string): StatusMeta {
  return SPEND_STATUS[s] ?? { ...UNKNOWN, label: s };
}
export function evidenceStatus(s: string): StatusMeta {
  return EVIDENCE_STATUS[s] ?? { ...UNKNOWN, label: s };
}
