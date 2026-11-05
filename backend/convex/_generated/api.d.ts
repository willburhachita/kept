/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentApi from "../agentApi.js";
import type * as ai_claude from "../ai/claude.js";
import type * as ai_examiner from "../ai/examiner.js";
import type * as ai_prompts from "../ai/prompts.js";
import type * as ai_screener from "../ai/screener.js";
import type * as apiKeys from "../apiKeys.js";
import type * as arbiter from "../arbiter.js";
import type * as auth from "../auth.js";
import type * as compiler from "../compiler.js";
import type * as contracts from "../contracts.js";
import type * as crons from "../crons.js";
import type * as effects from "../effects.js";
import type * as engine from "../engine.js";
import type * as evidence from "../evidence.js";
import type * as funding from "../funding.js";
import type * as http from "../http.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_journal from "../lib/journal.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_outbox from "../lib/outbox.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_validators from "../lib/validators.js";
import type * as mandates from "../mandates.js";
import type * as notifications from "../notifications.js";
import type * as outbound from "../outbound.js";
import type * as rails_index from "../rails/index.js";
import type * as rails_paypal from "../rails/paypal.js";
import type * as rails_sim from "../rails/sim.js";
import type * as rails_types from "../rails/types.js";
import type * as routes_agent from "../routes/agent.js";
import type * as routes_mcp from "../routes/mcp.js";
import type * as routes_paypal from "../routes/paypal.js";
import type * as routes_public from "../routes/public.js";
import type * as routes_rest from "../routes/rest.js";
import type * as testkit from "../testkit.js";
import type * as transparency from "../transparency.js";
import type * as users from "../users.js";
import type * as verification from "../verification.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentApi: typeof agentApi;
  "ai/claude": typeof ai_claude;
  "ai/examiner": typeof ai_examiner;
  "ai/prompts": typeof ai_prompts;
  "ai/screener": typeof ai_screener;
  apiKeys: typeof apiKeys;
  arbiter: typeof arbiter;
  auth: typeof auth;
  compiler: typeof compiler;
  contracts: typeof contracts;
  crons: typeof crons;
  effects: typeof effects;
  engine: typeof engine;
  evidence: typeof evidence;
  funding: typeof funding;
  http: typeof http;
  "lib/authz": typeof lib_authz;
  "lib/env": typeof lib_env;
  "lib/errors": typeof lib_errors;
  "lib/journal": typeof lib_journal;
  "lib/ledger": typeof lib_ledger;
  "lib/notify": typeof lib_notify;
  "lib/outbox": typeof lib_outbox;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/secrets": typeof lib_secrets;
  "lib/validators": typeof lib_validators;
  mandates: typeof mandates;
  notifications: typeof notifications;
  outbound: typeof outbound;
  "rails/index": typeof rails_index;
  "rails/paypal": typeof rails_paypal;
  "rails/sim": typeof rails_sim;
  "rails/types": typeof rails_types;
  "routes/agent": typeof routes_agent;
  "routes/mcp": typeof routes_mcp;
  "routes/paypal": typeof routes_paypal;
  "routes/public": typeof routes_public;
  "routes/rest": typeof routes_rest;
  testkit: typeof testkit;
  transparency: typeof transparency;
  users: typeof users;
  verification: typeof verification;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
