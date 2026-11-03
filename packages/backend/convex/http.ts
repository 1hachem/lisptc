import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth.js";
import { streamModel } from "./drafts.js";
import { MODEL_ROUTE } from "./lib/deltas.js";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({ path: MODEL_ROUTE, method: "POST", handler: streamModel });

export default http;
