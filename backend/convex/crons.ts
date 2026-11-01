import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("fire overdue deadlines", { minutes: 1 }, internal.engine.sweepDeadlines);
crons.interval("advance evidence timers", { minutes: 1 }, internal.evidence.sweepTimers);
crons.interval("restart stuck payments", { minutes: 2 }, internal.effects.reapStuck);
crons.interval("authorization expiry guard", { minutes: 15 }, internal.engine.authorizationMaintenance);
crons.interval("expire mandates", { minutes: 5 }, internal.mandates.expireDue);
crons.interval("seal transparency checkpoint", { minutes: 10 }, internal.transparency.checkpoint);
crons.interval("retry webhook deliveries", { minutes: 2 }, internal.outbound.deliverDue);
crons.interval("poll pending PayPal captures", { minutes: 5 }, internal.effects.pollPendingCaptures);
crons.interval("time out stuck agent screening", { minutes: 2 }, internal.agentApi.sweepScreening);
crons.interval("fail stale compiles", { minutes: 5 }, internal.compiler.failStaleCompiles);

export default crons;
