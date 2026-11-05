/**
 * End-to-end smoke runs against a live deployment (internal only: callable
 * from the Convex CLI or dashboard with deploy credentials, never from the
 * app or the REST API). Each run creates fresh test users (@kept.test), then
 * drives the same internal functions the app uses, through the real
 * scheduler and payment rail, and reports what happened at every step.
 *
 *   npx convex run testkit:contractFlow
 *   npx convex run testkit:mandateFlow
 */
import { logoFixed, officeSuppliesMandate, verifyChain, type SignedJournalEntry } from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type ActionCtx } from "./_generated/server";
import { env } from "./lib/env";
import { hashSecret } from "./lib/secrets";

export const _createUser = internalMutation({
  args: { email: v.string(), name: v.string(), payoutEmail: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const userId = await ctx.db.insert("users", { email: a.email });
    await ctx.db.insert("profiles", { userId, email: a.email, displayName: a.name, role: "user", createdAt: Date.now(), ...(a.payoutEmail ? { payoutEmail: a.payoutEmail } : {}) });
    return userId;
  },
});

type Log = { step: string; ok: boolean; detail: string; ms: number }[];

function logger() {
  const log: Log = [];
  let t = Date.now();
  return {
    log,
    add(step: string, ok: boolean, detail: string) {
      log.push({ step, ok, detail, ms: Date.now() - t });
      t = Date.now();
    },
  };
}

async function waitFor<T>(read: () => Promise<T>, done: (x: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let x = await read();
  while (!done(x) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    x = await read();
  }
  return x;
}

async function publicKeys(): Promise<Record<string, string>> {
  const res = await fetch(`${env.convexSiteUrl()}/.well-known/kept-keys.json`);
  const body = (await res.json()) as { keys: { keyId: string; publicKey: string }[] };
  return Object.fromEntries(body.keys.map((k) => [k.keyId, k.publicKey]));
}

async function users(ctx: ActionCtx, tag: string) {
  const stamp = `${tag}-${Date.now()}`;
  const funder: Id<"users"> = await ctx.runMutation(internal.testkit._createUser, { email: `payer-${stamp}@kept.test`, name: "Test Payer" });
  const payee: Id<"users"> = await ctx.runMutation(internal.testkit._createUser, { email: `payee-${stamp}@kept.test`, name: "Test Designer", payoutEmail: `payee-paypal-${stamp}@kept.test` });
  const stranger: Id<"users"> = await ctx.runMutation(internal.testkit._createUser, { email: `stranger-${stamp}@kept.test`, name: "Stranger" });
  return { funder, payee, stranger, payeeEmail: `payee-${stamp}@kept.test` };
}

/** The $300 logo deal from creation to settlement, then an independent receipt check. */
export const contractFlow = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; rail: string; contractId: string | null; log: Log }> => {
    const L = logger();
    let contractId: Id<"contracts"> | null = null;
    try {
      const { funder, payee, stranger, payeeEmail } = await users(ctx, "c");
      L.add("create test users", true, "payer, payee (with payout email), stranger");

      const created = await ctx.runAction(internal.contracts.createAs, { userId: funder, prompt: "Logo deal (smoke test)", role: "funder", counterpartyEmail: payeeEmail, ir: logoFixed });
      contractId = created.contractId;
      L.add("payer creates promise from template", true, `contract ${contractId}, invite link issued`);

      let wrongEmailRefused = false;
      try {
        await ctx.runMutation(internal.contracts.acceptInviteAs, { userId: stranger, token: created.inviteToken });
      } catch {
        wrongEmailRefused = true;
      }
      L.add("invite refuses a different account", wrongEmailRefused, wrongEmailRefused ? "bound to the invited email" : "LEAK: anyone with the link could join");

      await ctx.runMutation(internal.contracts.acceptInviteAs, { userId: payee, token: created.inviteToken });
      L.add("payee accepts the invite", true, "joined as payee");

      let blocked = false;
      try {
        await ctx.runQuery(internal.contracts.getAs, { userId: stranger, contractId });
      } catch {
        blocked = true;
      }
      L.add("stranger cannot open the promise", blocked, blocked ? "NOT_FOUND for a non-party" : "LEAK: stranger could read it");

      const c = await waitFor(() => ctx.runQuery(internal.contracts.getAs, { userId: funder, contractId: contractId! }), (x) => x.status !== "verifying" && x.status !== "draft");
      L.add("verifier proves the terms", c.status === "review" && c.verification?.ok === true, `${c.status}: ${c.verification?.summary ?? "no report"}`);

      for (const [who, userId] of [["payer", funder], ["payee", payee]] as const) {
        const r = await ctx.runMutation(internal.contracts.approveAs, { userId, contractId, termsHash: c.termsHash! });
        L.add(`${who} approves terms ${c.termsHash!.slice(0, 8)}`, true, `status ${r.status}`);
      }

      const order = await ctx.runAction(internal.funding.startAs, { userId: funder, contractId });
      L.add("payer starts funding", true, `order ${order.orderId.slice(0, 24)}…, approval page ${new URL(order.approveUrl).pathname}`);
      const conf = await ctx.runAction(internal.funding.confirmAs, { userId: funder, contractId });
      L.add("payment confirmed, promise goes live", conf.status === "active", `status ${conf.status}`);

      const afterStart = await waitFor(() => ctx.runQuery(internal.contracts.getAs, { userId: funder, contractId: contractId! }), (x) => x.ledger.paidOutCents >= 10_000);
      L.add("upfront $100 captured and paid out", afterStart.ledger.paidOutCents === 10_000, `captured ${afterStart.ledger.capturedCents}¢, paid out ${afterStart.ledger.paidOutCents}¢, held ${afterStart.ledger.heldCents}¢`);

      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><text x="10" y="40" font-size="32" fill="#0a0a0a">Acme</text></svg>';
      const storageId = await ctx.storage.store(new Blob([svg], { type: "image/svg+xml" }));
      const sub = await ctx.runMutation(internal.evidence.submitAs, { userId: payee, contractId, slotId: "final_svg", storageId, fileName: "acme-logo.svg" });
      L.add("payee delivers the logo (SVG)", true, `evidence ${sub.evidenceId}, status ${sub.status}`);

      if (sub.status === "checking") {
        const ev = await waitFor(
          () => ctx.runQuery(internal.evidence.listAs, { userId: funder, contractId: contractId! }),
          (xs) => xs.every((x) => x.status !== "checking"),
          120_000,
        );
        L.add("AI examiner checks the delivery", true, ev.map((x) => `${x.slotLabel}: ${x.statusLabel}`).join("; "));
      }
      await ctx.runMutation(internal.evidence.acceptAs, { userId: funder, evidenceId: sub.evidenceId });
      L.add("payer accepts the delivery", true, "rules release the remaining $200");

      const end = await waitFor(() => ctx.runQuery(internal.contracts.getAs, { userId: funder, contractId: contractId! }), (x) => x.status === "settled", 120_000);
      const ledgerOk = end.ledger.releasedCents === 30_000 && end.ledger.feesCents === 750 && end.ledger.paidOutCents === 30_000 && end.ledger.heldCents === 0;
      L.add("promise settles", end.status === "settled" && ledgerOk, `status ${end.status}; released ${end.ledger.releasedCents}¢, fees ${end.ledger.feesCents}¢, captured ${end.ledger.capturedCents}¢, paid out ${end.ledger.paidOutCents}¢, held ${end.ledger.heldCents}¢`);

      const rows = await ctx.runQuery(internal.contracts.journalAs, { userId: funder, contractId, limit: 500 });
      const keys = await publicKeys();
      const chain = verifyChain(rows.map((r) => ({ ...r, stream: contractId! })) as SignedJournalEntry[], keys);
      L.add("receipts verify against the published key", chain.ok, chain.ok ? `${chain.checked} signed entries, hash chain intact` : `failed at ${chain.failedAt}: ${chain.reason}`);
    } catch (e) {
      L.add("unexpected error", false, e instanceof Error ? e.message.slice(0, 400) : String(e));
    }
    return { ok: L.log.every((x) => x.ok), rail: env.rail(), contractId, log: L.log };
  },
});

/** An agent budget: fund, issue a token, four purchases (paid, needs approval, two denied), approve, close. */
export const mandateFlow = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; rail: string; mandateId: string | null; log: Log }> => {
    const L = logger();
    let mandateId: Id<"mandates"> | null = null;
    try {
      const { funder: owner } = await users(ctx, "m");
      const m = await ctx.runMutation(internal.mandates.createAs, { userId: owner, policy: officeSuppliesMandate });
      mandateId = m.mandateId;
      L.add("owner creates agent budget", m.verified, `mandate ${mandateId}, policy ${m.verified ? "proved" : "NOT proved"}`);

      await ctx.runAction(internal.mandates.fundStartAs, { userId: owner, mandateId });
      const f = await ctx.runAction(internal.mandates.fundConfirmAs, { userId: owner, mandateId });
      L.add("budget held on the payment rail", f.status === "active", `status ${f.status}`);

      const { token } = await ctx.runAction(internal.mandates.issueTokenAs, { userId: owner, mandateId, label: "smoke-test agent" });
      const tokenHash = hashSecret(token);
      L.add("agent token issued", true, `${token.slice(0, 6)}… (stored only as a hash)`);

      const spend = (amountCents: number, key: string, merchantEmail = "desk@supplies.example.com", description = "printer paper") =>
        ctx.runMutation(internal.agentApi.requestSpend, { tokenHash, merchantEmail, merchantName: "Supplies", amountCents, currency: "USD", description, idempotencyKey: key });
      const a = await spend(2_500, "s1");
      L.add("agent buys $25 paper", a.status === "executing", `${a.status}`);
      const again = await spend(2_500, "s1");
      L.add("same request retried (idempotent)", again.spendId === a.spendId, again.spendId === a.spendId ? "same spend returned, no double charge" : "DUPLICATE spend");
      const b = await spend(4_000, "s2", undefined, "toner");
      L.add("agent asks for $40 toner", b.status === "needs_approval", `${b.status}: ${b.reasons.join("; ")}`);
      const c = await spend(6_000, "s3", undefined, "desk chair");
      L.add("agent tries a $60 chair", c.status === "denied", `${c.status}: ${c.reasons.join("; ")}`);
      const d = await spend(1_000, "s4", "x@unknown-shop.example", "gift cards");
      L.add("agent tries an unlisted merchant", d.status === "denied", `${d.status}: ${d.reasons.join("; ")}`);

      await ctx.runMutation(internal.mandates.decideSpendAs, { userId: owner, spendId: b.spendId, approve: true });
      const view = await waitFor(() => ctx.runQuery(internal.mandates.getAs, { userId: owner, mandateId: mandateId! }), (x) => x.spentCents === 6_500 && x.funding?.paidOutCents === 6_500, 90_000);
      L.add("owner approves the toner; both paid", view.spentCents === 6_500, `spent ${view.money.spent}, fees ${view.money.fees}, left ${view.money.remaining}, paid out ${view.funding?.paidOutCents}¢`);

      await ctx.runMutation(internal.mandates.revokeAs, { userId: owner, mandateId });
      const closed = await waitFor(() => ctx.runQuery(internal.mandates.getAs, { userId: owner, mandateId: mandateId! }), (x) => x.status === "closed", 90_000);
      L.add("owner closes the budget; unused hold released", closed.status === "closed", `status ${closed.status}, voided ${closed.funding?.voided?.cents ?? 0}¢`);

      const late = await spend(100, "s5");
      L.add("agent spend after close is refused", late.status === "denied", `${late.status}: ${late.reasons.join("; ")}`);
    } catch (e) {
      L.add("unexpected error", false, e instanceof Error ? e.message.slice(0, 400) : String(e));
    }
    return { ok: L.log.every((x) => x.ok), rail: env.rail(), mandateId, log: L.log };
  },
});
