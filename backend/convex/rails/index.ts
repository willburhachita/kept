import { env } from "../lib/env";
import { paypalRail } from "./paypal";
import { simRail } from "./sim";
import type { PaymentRail } from "./types";

export function getRail(): PaymentRail {
  return env.rail() === "sim" ? simRail : paypalRail;
}

export * from "./types";
