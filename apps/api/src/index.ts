import { serve } from "@hono/node-server";
import app from "./app.ts";

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port }, (info) =>
	console.log(`@lisptc/api listening on http://localhost:${info.port}`),
);

// The listening socket keeps the event loop alive, so without this the process
// outlives its supervisor and holds the port until it is killed by hand.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		server.close(() => process.exit(0));
		// `close` only refuses *new* connections and then waits for the open ones —
		// and an open SSE chat stream never ends on its own.
		if ("closeAllConnections" in server) server.closeAllConnections();
	});
}
