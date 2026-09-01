import { type ServerType, serve } from "@hono/node-server";
import { formatError, log } from "./log.ts";

type FetchCallback = Parameters<typeof serve>[0]["fetch"];

// How long a shutdown waits for in-flight responses before it stops being polite.
const CLOSE_TIMEOUT_MS = 2_000;

export interface StartOptions {
	fetch: FetchCallback;
	port: number;
}

/**
 * Serve the app in production. In dev the socket belongs to vite (see
 * `vite.config.ts`), so only the process-level handlers below are shared.
 */
export function startServer(options: StartOptions): ServerType {
	installProcessHandlers();

	const server = serve({ fetch: options.fetch, port: options.port }, (info) =>
		log.info(`@lisptc/api listening on http://localhost:${info.port}`),
	);

	server.on("error", (err: NodeJS.ErrnoException) => {
		// Without a listener this is an unhandled 'error' event, i.e. a stack trace
		// with no hint of what to do about it — and EADDRINUSE is by far the most
		// common way this server fails to start.
		if (err.code === "EADDRINUSE") {
			log.error(
				`port ${options.port} is already in use — another api is still running (set PORT to use another)`,
			);
			process.exit(1);
		}
		log.error(`server error — ${formatError(err)}`);
	});

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			log.info(`${signal} — shutting down`);
			// The listening socket keeps the event loop alive, so without this the
			// process outlives its supervisor and holds the port until it is killed
			// by hand.
			server.close(() => process.exit(0));
			// `close` only refuses *new* connections and then waits for the open ones
			// — and an open SSE chat stream never ends on its own, so on its own this
			// hangs forever and the next server dies on EADDRINUSE.
			if ("closeAllConnections" in server) server.closeAllConnections();
			setTimeout(() => process.exit(0), CLOSE_TIMEOUT_MS).unref();
		});
	}

	return server;
}

// vite re-evaluates the module graph on every edit, so this would otherwise
// stack up a fresh pair of listeners (and a duplicate log line) per reload.
const INSTALLED = Symbol.for("lisptc.api.process-handlers");

/**
 * Report the two failures that otherwise escape every request-scoped handler.
 * Production dies and gets restarted; the dev server logs and keeps serving,
 * since the next edit probably fixes it.
 */
export function installProcessHandlers(): void {
	const globals = globalThis as Record<symbol, unknown>;
	if (globals[INSTALLED]) return;
	globals[INSTALLED] = true;

	// vite sets NODE_ENV itself; plain `node src/index.ts` leaves it unset.
	const isDev = process.env.NODE_ENV === "development";

	process.on("uncaughtException", (err) => {
		log.error(`uncaught exception — ${formatError(err)}`);
		if (!isDev) process.exit(1);
	});
	process.on("unhandledRejection", (reason) => {
		log.error(`unhandled rejection — ${formatError(reason)}`);
	});
}
