import type { McpTransport, ServerRef, ServerReporter } from "./ports.ts";

export interface ReportedTransport {
	readonly transport: McpTransport;
	end(): Promise<void>;
}

export function reportedTransport(
	server: ServerRef,
	inner: McpTransport,
	report: ServerReporter,
	ended: () => void,
): ReportedTransport {
	const about = { server: server.name };
	let closing = false;
	let started = false;
	let lastError: Error | undefined;
	const transport: McpTransport = {
		async start() {
			report({ ...about, phase: "starting" });
			try {
				await inner.start();
			} catch (ex) {
				report({
					...about,
					phase: "failed",
					reason: ex instanceof Error ? ex.message : String(ex),
				});
				throw ex;
			}
			started = true;
			report({ ...about, phase: "ready" });
		},
		send: (message) => inner.send(message),
		async close() {
			closing = true;
			await inner.close();
		},
	};
	inner.onmessage = (message) => transport.onmessage?.(message);
	inner.onerror = (error) => {
		lastError = error;
		transport.onerror?.(error);
	};
	inner.onclose = () => {
		ended();
		if (started)
			report(
				closing
					? { ...about, phase: "sleeping" }
					: {
							...about,
							phase: "failed",
							reason: lastError?.message ?? "its process exited.",
						},
			);
		transport.onclose?.();
	};
	return {
		transport,
		async end() {
			closing = true;
			await inner.close().catch(() => {});
		},
	};
}
