/**
 * The one place that talks to Claude. Every AI step returns schema-constrained
 * JSON (structured outputs) that is then re-validated by deterministic code.
 * AI output is never trusted directly: it is compiled, checked or used only to
 * make the system more cautious.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../lib/env";
import { fail } from "../lib/errors";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Content blocks accepted in the user turn (text, base64 image, base64 PDF). */
export type UserBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export interface StructuredRequest {
  system: string;
  content: UserBlock[];
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}

export interface StructuredResponse<T> {
  value: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function aiConfigured(): boolean {
  return env.anthropicKey() !== null;
}

let client: { key: string; c: Anthropic } | null = null;

function getClient(): Anthropic {
  const key = env.anthropicKey();
  if (!key) fail("CONFIG_MISSING", "AI is not configured (ANTHROPIC_API_KEY).");
  if (client?.key !== key) client = { key, c: new Anthropic({ apiKey: key, maxRetries: 1, timeout: 120_000 }) };
  return client.c;
}

/** One structured-output call. Throws AppError(AI_FAILED / CONFIG_MISSING) on failure. */
export async function callStructured<T>(req: StructuredRequest): Promise<StructuredResponse<T>> {
  const anthropic = getClient();
  const params = {
    model: env.model(),
    max_tokens: req.maxTokens ?? 16_000,
    // Server-side fallback: a declined request is retried on Anthropic's recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: req.system,
    messages: [{ role: "user", content: req.content }],
    output_config: { effort: req.effort ?? "high", format: { type: "json_schema", schema: req.schema } },
  };
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = (await anthropic.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)) as Anthropic.Beta.BetaMessage;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) fail("CONFIG_MISSING", "The ANTHROPIC_API_KEY was rejected.");
    if (e instanceof Anthropic.RateLimitError) fail("AI_FAILED", "The AI service is busy. Try again in a minute.");
    if (e instanceof Anthropic.BadRequestError) fail("AI_FAILED", `The AI request was rejected: ${e.message.slice(0, 300)}`);
    if (e instanceof Anthropic.APIError) fail("AI_FAILED", `AI service error (${e.status ?? "network"}).`);
    throw e;
  }
  if (response.stop_reason === "refusal") fail("AI_FAILED", "The AI declined to process this request.");
  if (response.stop_reason === "max_tokens") fail("AI_FAILED", "The AI response was cut off. Simplify the request and try again.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let value: T;
  try {
    value = JSON.parse(text) as T;
  } catch {
    fail("AI_FAILED", "The AI returned malformed output.");
  }
  return { value, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}

/** Wrap untrusted text so prompts can tell data from instructions. */
export function untrusted(label: string, text: string): string {
  const safe = text.replace(/<\/?untrusted[^>]*>/gi, "");
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}
