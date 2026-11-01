import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { registerAgentApi } from "./routes/agent";
import { registerMcp } from "./routes/mcp";
import { registerPaypalWebhooks } from "./routes/paypal";
import { registerPublic } from "./routes/public";
import { registerRestApi } from "./routes/rest";

const http = httpRouter();

auth.addHttpRoutes(http);
registerPublic(http);
registerPaypalWebhooks(http);
registerRestApi(http);
registerAgentApi(http);
registerMcp(http);

export default http;
