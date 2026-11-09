import type { McpTransport, ServerReporter } from "./ports.ts";

export interface ReportedTransport {
	readonly transport: McpTransport;
	end(): Promise<void>;
}

export function reportedTransport(
	server: string,
	inner: McpTransport,
	report: ServerReporter,
	ended: () => void,
): ReportedTransport {
	let closing = false;
	let started = false;
	let lastError: Error | undefined;
	const transport: McpTransport = {
		async start() {
			report({ server, phase: "starting" });
			try {
				await inner.start();
			} catch (ex) {
				report({
					server,
					phase: "failed",
					reason: ex instanceof Error ? ex.message : String(ex),
				});
				throw ex;
			}
			started = true;
			report({ server, phase: "ready" });
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
					? { server, phase: "sleeping" }
					: {
							server,
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
