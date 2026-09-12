import { spawn } from "node:child_process";

export type ServerSpec = {
	name: string;
	headers?: Record<string, string>;
	oauth?: boolean;
	scopes?: string[];
} & (
	| { origin: "remote"; url: string }
	| {
			origin: "program";
			command: string;
			args?: string[];
			env?: Record<string, string>;
			url?: string;
	  }
);

export type Endpoint =
	| {
			transport: "stdio";
			command: string;
			args: string[];
			env?: Record<string, string>;
	  }
	| {
			transport: "http";
			url: string;
			headers?: Record<string, string>;
			oauth?: boolean;
			scopes?: string[];
	  };

export interface Instance {
	sessionId: string;
	server: string;
}

export interface McpRuntime {
	start(
		spec: ServerSpec,
		instance: Instance,
		signal?: AbortSignal,
	): Promise<Endpoint>;
	stop(instance: Instance): Promise<void>;
	stopAll(sessionId: string): Promise<void>;
}

export const DEFAULT_SESSION = "local";

const LOCAL_START_TIMEOUT_MS = 60_000;
const LOCAL_POLL_MS = 250;
const LOCAL_STDERR_KEEP = 4096;

interface LocalServer {
	child: ReturnType<typeof spawn>;
	stderr: string;
}

function instanceKey(instance: Instance): string {
	return `${instance.sessionId}/${instance.server}`;
}

function httpEndpoint(
	spec: ServerSpec & { url: string },
): Extract<Endpoint, { transport: "http" }> {
	return {
		transport: "http",
		url: spec.url,
		headers: spec.headers,
		oauth: spec.oauth,
		scopes: spec.scopes,
	};
}

async function reachable(url: string): Promise<boolean> {
	try {
		await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
		return true;
	} catch {
		return false;
	}
}

function startChild(spec: {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}): LocalServer {
	const child = spawn(spec.command, spec.args ?? [], {
		detached: true,
		stdio: ["ignore", "ignore", "pipe"],
		env: {
			...(process.env as Record<string, string>),
			...(spec.env ?? {}),
		},
	});
	const server: LocalServer = { child, stderr: "" };
	child.stderr?.on("data", (chunk: Buffer) => {
		server.stderr = (server.stderr + chunk.toString()).slice(
			-LOCAL_STDERR_KEEP,
		);
	});
	child.on("error", (err) => {
		server.stderr += `\n${err.message}`;
	});
	child.unref();
	return server;
}

function whyItDied(server: LocalServer): string {
	const tail = server.stderr.trim().split("\n").slice(-6).join("\n");
	return tail ? `\n${tail}` : "";
}

function killChild(server: LocalServer): void {
	const { pid } = server.child;
	try {
		if (pid !== undefined) process.kill(-pid, "SIGTERM");
	} catch {
		server.child.kill("SIGTERM");
	}
}

export function createLocalRuntime(): McpRuntime {
	const started = new Map<string, LocalServer>();

	async function ensureStarted(
		spec: ServerSpec & { origin: "program"; url: string },
		instance: Instance,
		signal?: AbortSignal,
	): Promise<void> {
		const origin = new URL(spec.url).origin;
		if (await reachable(origin)) return;
		const key = instanceKey(instance);
		let server = started.get(key);
		if (!server || server.child.exitCode !== null) {
			server = startChild(spec);
			started.set(key, server);
		}
		const deadline = Date.now() + LOCAL_START_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (signal?.aborted) throw new Error(`${spec.name}: start was cancelled`);
			if (await reachable(origin)) return;
			if (server.child.exitCode !== null) {
				started.delete(key);
				throw new Error(
					`${spec.name}: its server exited with code ${server.child.exitCode} before ${origin} answered.${whyItDied(server)}`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, LOCAL_POLL_MS));
		}
		throw new Error(
			`${spec.name}: started its server but ${origin} did not answer within ${LOCAL_START_TIMEOUT_MS / 1000}s.${whyItDied(server)}`,
		);
	}

	return {
		async start(spec, instance, signal) {
			if (spec.origin === "remote") return httpEndpoint(spec);
			if (spec.url === undefined)
				return {
					transport: "stdio",
					command: spec.command,
					args: spec.args ?? [],
					env: {
						...(process.env as Record<string, string>),
						...(spec.env ?? {}),
					},
				};
			await ensureStarted({ ...spec, url: spec.url }, instance, signal);
			return httpEndpoint({ ...spec, url: spec.url });
		},

		async stop(instance) {
			const key = instanceKey(instance);
			const server = started.get(key);
			if (!server) return;
			killChild(server);
			started.delete(key);
		},

		async stopAll(sessionId) {
			const prefix = `${sessionId}/`;
			for (const [key, server] of started) {
				if (!key.startsWith(prefix)) continue;
				killChild(server);
				started.delete(key);
			}
		},
	};
}

let shared: McpRuntime | undefined;

export function localRuntime(): McpRuntime {
	shared ??= createLocalRuntime();
	return shared;
}
