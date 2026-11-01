/**
 * Typed access to the Convex backend. The API object and the data model come
 * straight from backend/convex/_generated, so every call is checked end to end.
 */
import type { FunctionReturnType } from "convex/server";
import { api } from "../../backend/convex/_generated/api";

export { api };
export type { Doc, Id } from "../../backend/convex/_generated/dataModel";

export type Viewer = NonNullable<FunctionReturnType<typeof api.users.viewer>>;
export type ContractView = FunctionReturnType<typeof api.contracts.get>;
export type ContractCard = FunctionReturnType<typeof api.contracts.listMine>[number];
export type CompileRun = FunctionReturnType<typeof api.compiler.latestRun>;
export type MandateView = FunctionReturnType<typeof api.mandates.get>;
export type MandateCard = FunctionReturnType<typeof api.mandates.listMine>[number];
