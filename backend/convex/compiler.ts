/**
 * The AI compiler: plain English -> promises (spec) -> rules (clauses) ->
 * exhaustive verification -> repair loop. Every step is written to
 * compileRuns as it happens, so a UI subscribed to `latestRun` shows the
 * proof being built live. The repair loop can only change rules; the spec is
 * frozen by hash, so the model cannot "fix" a counterexample by weakening a
 * promise.
 */
import {
  CLAUSES_OUTPUT_SCHEMA,
  SPEC_OUTPUT_SCHEMA,
  canonicalJson,
  validateClauses,
  validateSpec,
  verify,
  violationsForRepair,
  type Clause,
  type ContractIR,
  type ContractSpec,
  type VerificationReport,
} from "@kept/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx, type QueryCtx } from "./_generated/server";
import { aiConfigured, callStructured } from "./ai/claude";
import { CLAUSES_SYSTEM, REPAIR_SYSTEM, SPEC_SYSTEM, clausesRequest, repairRequest, specRequest } from "./ai/prompts";
import { applyTerms } from "./contracts";
import { isParticipant, loadContract, readableContract, requireUserId } from "./lib/authz";
import { env } from "./lib/env";
import { fail } from "./lib/errors";
import { actorUser, appendJournal } from "./lib/journal";
import { LIMITS, rateLimit } from "./lib/rateLimit";

const MAX_REPAIR_ROUNDS = 4;

interface SpecOutput extends Omit<ContractSpec, "irVersion"> {
  assumptions: string[];
  questions: string[];
}

const stepV = v.object({ kind: v.string(), ok: v.boolean(), title: v.string(), detail: v.string(), data: v.optional(v.any()) });

export const _begin = internalMutation({
  args: { contractId: v.id("contracts"), userId: v.id("users") },
  handler: async (ctx, { contractId, userId }) => {
    const c = await loadContract(ctx, contractId);
    if (!isParticipant(c, userId)) fail("NOT_FOUND", "Contract not found.");
    if (!["draft", "review", "needs_attention"].includes(c.status)) fail("INVALID_STATE", `Cannot compile while the contract is ${c.status}.`);
    if (!c.prompt.trim()) fail("INVALID_ARGUMENT", "Describe the agreement first.");
    if (!aiConfigured()) fail("CONFIG_MISSING", "AI is not configured (ANTHROPIC_API_KEY). Use a template or set the terms directly.");
    await rateLimit(ctx, `compile:${userId}`, LIMITS.compile);
    const now = Date.now();
    await ctx.db.patch(c._id, { status: "compiling", approvals: {}, updatedAt: now });
    const runId = await ctx.db.insert("compileRuns", {
      contractId,
      startedBy: userId,
      status: "running",
      stage: "spec",
      steps: [],
      assumptions: [],
      questions: [],
      model: env.model(),
      startedAt: now,
    });
    await appendJournal(ctx, c._id, actorUser(userId), "compile.started", { runId, model: env.model() });
    return { runId, prompt: c.prompt, feeBps: c.feeBps, previousStatus: c.status };
  },
});

export const _step = internalMutation({
  args: { runId: v.id("compileRuns"), stage: v.string(), step: stepV },
  handler: async (ctx, { runId, stage, step }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") return;
    await ctx.db.patch(runId, { stage, steps: [...run.steps, { ...step, at: Date.now() }] });
  },
});

export const _finish = internalMutation({
  args: {
    runId: v.id("compileRuns"),
    contractId: v.id("contracts"),
    userId: v.id("users"),
    ir: v.any(),
    assumptions: v.array(v.string()),
    questions: v.array(v.string()),
    rounds: v.number(),
    proved: v.boolean(),
  },
  handler: async (ctx, a) => {
    const c = await loadContract(ctx, a.contractId);
    if (c.status !== "compiling") fail("CONFLICT", "The contract changed while compiling.");
    await ctx.db.patch(c._id, { status: "draft" }); // applyTerms moves it to verifying
    const fresh = await loadContract(ctx, a.contractId);
    const { irHash } = await applyTerms(ctx, fresh, a.ir, actorUser(a.userId), "compiler");
    await ctx.db.patch(a.runId, {
      status: "succeeded",
      stage: "done",
      assumptions: a.assumptions.slice(0, 30),
      questions: a.questions.slice(0, 20),
      finishedAt: Date.now(),
    });
    await appendJournal(ctx, c._id, "system", "compile.finished", { runId: a.runId, irHash, rounds: a.rounds, provedBeforeSubmit: a.proved });
  },
});

export const _fail = internalMutation({
  args: { runId: v.id("compileRuns"), contractId: v.id("contracts"), error: v.string(), previousStatus: v.string() },
  handler: async (ctx, { runId, contractId, error, previousStatus }) => {
    const run = await ctx.db.get(runId);
    if (run && run.status === "running") {
      await ctx.db.patch(runId, {
        status: "failed",
        stage: "failed",
        error: error.slice(0, 500),
        finishedAt: Date.now(),
        steps: [...run.steps, { kind: "error", ok: false, title: "Compilation failed", detail: error.slice(0, 500), at: Date.now() }],
      });
    }
    const c = await ctx.db.get(contractId);
    if (c && c.status === "compiling") {
      const restore = previousStatus === "review" || previousStatus === "needs_attention" ? (c.ir ? "needs_attention" : "draft") : "draft";
      await ctx.db.patch(c._id, { status: restore as "draft" | "needs_attention", updatedAt: Date.now() });
      await appendJournal(ctx, c._id, "system", "compile.failed", { runId, error: error.slice(0, 300) });
    }
  },
});

function issuesOf(res: { issues: { severity: string; path: string; message: string }[] }): string[] {
  return res.issues.filter((i) => i.severity === "error").slice(0, 15).map((i) => `${i.path}: ${i.message}`);
}

function reportData(r: VerificationReport) {
  const first = r.properties.find((p) => p.status === "violated" && p.severity === "error") ?? r.properties.find((p) => p.status === "violated");
  return {
    ok: r.ok,
    summary: r.summary,
    states: r.stats.states,
    ms: r.stats.ms,
    violated: r.properties.filter((p) => p.status === "violated").map((p) => ({ id: p.id, title: p.title, severity: p.severity })),
    firstCounterexample: first?.counterexample ? { property: first.title, steps: first.counterexample.steps.map((s) => s.narration.join(" ")), outcome: first.counterexample.outcome } : null,
    outcomes: r.outcomes.length,
    bounds: r.bounds,
  };
}

interface CompileResult {
  runId: Id<"compileRuns">;
  ok: boolean;
  rounds: number;
}

async function pipeline(ctx: ActionCtx, userId: Id<"users">, contractId: Id<"contracts">): Promise<CompileResult> {
  const begin: { runId: Id<"compileRuns">; prompt: string; feeBps: number; previousStatus: string } = await ctx.runMutation(
    internal.compiler._begin,
    { contractId, userId },
  );
  const { runId } = begin;
  const step = (stage: string, kind: string, ok: boolean, title: string, detail: string, data?: unknown) =>
    ctx.runMutation(internal.compiler._step, { runId, stage, step: { kind, ok, title, detail, ...(data === undefined ? {} : { data }) } });
  try {
    // 1. Promises first.
    let spec: ContractSpec | null = null;
    let specOut: SpecOutput | null = null;
    let issues: string[] | undefined;
    for (let attempt = 0; attempt < 2 && !spec; attempt++) {
      const r = await callStructured<SpecOutput>({ system: SPEC_SYSTEM, content: specRequest(begin.prompt, issues), schema: SPEC_OUTPUT_SCHEMA, effort: "high" });
      specOut = r.value;
      const { assumptions: _a, questions: _q, ...rest } = r.value;
      const res = validateSpec({ irVersion: 1, ...rest });
      if (res.ok) spec = res.value;
      else issues = issuesOf(res);
    }
    if (!spec || !specOut) throw new Error(`The AI could not produce a valid spec: ${(issues ?? []).join("; ")}`);
    await step("clauses", "spec", true, "Promises written", `${spec.guarantees.length} promise(s), ${spec.deadlines.length} deadline(s), ${spec.evidence.length} deliverable(s), ${spec.fundingMode} funding.`, {
      promises: spec.guarantees.map((g) => g.label),
      assumptions: specOut.assumptions,
    });
    const frozen = canonicalJson(spec);

    // 2. Rules against the frozen promises.
    let clauses: Clause[] | null = null;
    issues = undefined;
    for (let attempt = 0; attempt < 2 && !clauses; attempt++) {
      const r = await callStructured<{ clauses: unknown; rationale: string }>({ system: CLAUSES_SYSTEM, content: clausesRequest(begin.prompt, spec, issues), schema: CLAUSES_OUTPUT_SCHEMA, effort: "high" });
      const res = validateClauses(spec, r.value.clauses);
      if (res.ok) clauses = res.value;
      else issues = issuesOf(res);
    }
    if (!clauses) throw new Error(`The AI could not produce valid rules: ${(issues ?? []).join("; ")}`);
    await step("verify", "clauses", true, "Rules drafted", `${clauses.length} rule(s) written against the promises.`, { rules: clauses.map((c) => c.label) });

    // 3. Verify, 4. repair.
    let ir: ContractIR = { ...spec, clauses };
    let report = verify(ir, { feeBps: begin.feeBps });
    await step(report.ok ? "finish" : "repair", "verify", report.ok, report.ok ? "Proof passed" : "Verifier found a problem", report.summary, reportData(report));
    let rounds = 0;
    while (!report.ok && rounds < MAX_REPAIR_ROUNDS) {
      rounds++;
      let next: Clause[] | null = null;
      let repairIssues: string[] | undefined;
      for (let attempt = 0; attempt < 2 && !next; attempt++) {
        const r = await callStructured<{ clauses: unknown; rationale: string }>({
          system: REPAIR_SYSTEM,
          content: repairRequest(spec, ir.clauses, violationsForRepair(report), repairIssues),
          schema: CLAUSES_OUTPUT_SCHEMA,
          effort: "high",
        });
        const res = validateClauses(spec, r.value.clauses);
        if (res.ok) next = res.value;
        else repairIssues = issuesOf(res);
      }
      if (!next) {
        await step("repair", "repair", false, `Repair ${rounds} was invalid`, (repairIssues ?? []).join("; ").slice(0, 500));
        continue;
      }
      const candidate: ContractIR = { ...spec, clauses: next };
      const { clauses: _c, ...specPart } = candidate;
      if (canonicalJson(specPart) !== frozen) {
        await step("repair", "repair", false, `Repair ${rounds} rejected`, "The repair tried to change the promises, which is not allowed.");
        continue;
      }
      ir = candidate;
      report = verify(ir, { feeBps: begin.feeBps });
      await step(report.ok ? "finish" : "repair", "repair", report.ok, report.ok ? `Repair ${rounds}: proof passed` : `Repair ${rounds}: still failing`, report.summary, reportData(report));
    }

    const questions = [...(specOut.questions ?? [])];
    if (!report.ok) questions.push("The rules could not satisfy every promise automatically. The promises may conflict; review the counterexamples and adjust the description or the promises.");
    await step("finish", "finish", report.ok, report.ok ? "Ready for review" : "Needs attention", report.ok ? "Both parties can now review the verified terms." : "Submitted with the remaining counterexamples for review.", { rounds });
    await ctx.runMutation(internal.compiler._finish, {
      runId,
      contractId,
      userId,
      ir,
      assumptions: specOut.assumptions ?? [],
      questions,
      rounds,
      proved: report.ok,
    });
    return { runId, ok: report.ok, rounds };
  } catch (e) {
    const message = e instanceof ConvexError ? String((e.data as { message?: string })?.message ?? "Compilation failed") : e instanceof Error ? e.message : String(e);
    await ctx.runMutation(internal.compiler._fail, { runId, contractId, error: message, previousStatus: begin.previousStatus });
    throw e instanceof ConvexError ? e : new ConvexError({ code: "AI_FAILED", message });
  }
}

/** Compile the contract's plain-English description into verified terms. */
export const compile = action({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }): Promise<CompileResult> => pipeline(ctx, await requireUserId(ctx), contractId),
});

export const compileAs = internalAction({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }): Promise<CompileResult> => pipeline(ctx, userId, contractId),
});

async function latestRunFlow(ctx: QueryCtx, userId: Id<"users">, contractId: Id<"contracts">) {
  await readableContract(ctx, contractId, userId);
  const run = await ctx.db.query("compileRuns").withIndex("by_contract", (q) => q.eq("contractId", contractId)).order("desc").first();
  if (!run) return null;
  const lastVerify = [...run.steps].reverse().find((s) => s.kind === "verify" || s.kind === "repair");
  return { ...run, durationMs: (run.finishedAt ?? Date.now()) - run.startedAt, lastReport: lastVerify?.data ?? null };
}

/** Live progress of the newest compile run (subscribe to it from the UI). */
export const latestRun = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => latestRunFlow(ctx, await requireUserId(ctx), contractId),
});

export const latestRunAs = internalQuery({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }) => latestRunFlow(ctx, userId, contractId),
});

export const runs = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    const userId = await requireUserId(ctx);
    await readableContract(ctx, contractId, userId);
    const rows = await ctx.db.query("compileRuns").withIndex("by_contract", (q) => q.eq("contractId", contractId)).order("desc").take(20);
    return rows.map((r) => ({ _id: r._id, status: r.status, stage: r.stage, steps: r.steps.length, model: r.model, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null, error: r.error ?? null }));
  },
});
