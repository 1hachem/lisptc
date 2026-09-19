import { spawn } from "node:child_process";
import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
} from "./ports.ts";

const START_TIMEOUT_MS = 60_000;
const POLL_MS = 250;
const STDERR_KEEP = 4096;

interface LocalServer {
	child: ReturnType<typeof spawn>;
	stderr: string;
}

async function reachable(url: string): Promise<boolean> {
	try {
		await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
		return true;
	} catch {
		return false;
	}
}

function whyItDied(server: LocalServer): string {
	const tail = server.stderr.trim().split("\n").slice(-6).join("\n");
	return tail ? `\n${tail}` : "";
}

export class LocalProcessHost implements McpHost {
	private readonly started = new Map<string, LocalServer>();

	async ensure(conf: ConnConfig): Promise<ServerHandle | undefined> {
		if (!("url" in conf)) return undefined;
		const handle: ServerHandle = conf.headers
			? { url: conf.url, headers: conf.headers }
			: { url: conf.url };
		if (!conf.command) return handle;
		const origin = new URL(conf.url).origin;
		if (await reachable(origin)) return handle;
		let server = this.started.get(conf.name);
		if (!server || server.child.exitCode !== null) {
			server = this.spawn(conf.command, conf.args, conf.env);
			this.started.set(conf.name, server);
		}
		const deadline = Date.now() + START_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (await reachable(origin)) return handle;
			if (server.child.exitCode !== null) {
				this.started.delete(conf.name);
				throw new Error(
					`${conf.name}: its server exited with code ${server.child.exitCode} before ${origin} answered.${whyItDied(server)}`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
		throw new Error(
			`${conf.name}: started its server but ${origin} did not answer within ${START_TIMEOUT_MS / 1000}s.${whyItDied(server)}`,
		);
	}

	async stop(name: string): Promise<void> {
		const server = this.started.get(name);
		if (!server) return;
		const { pid } = server.child;
		try {
			if (pid !== undefined) process.kill(-pid, "SIGTERM");
		} catch {
			server.child.kill("SIGTERM");
		}
		this.started.delete(name);
	}

	async stopAll(): Promise<void> {
		for (const name of [...this.started.keys()]) await this.stop(name);
	}

	status(name: string): ServerState {
		const server = this.started.get(name);
		if (!server) return "unknown";
		return server.child.exitCode === null ? "running" : "stopped";
	}

	logs(name: string): string {
		return this.started.get(name)?.stderr ?? "";
	}

	private spawn(
		command: string,
		args?: string[],
		env?: Record<string, string>,
	): LocalServer {
		const child = spawn(command, args ?? [], {
			detached: true,
			stdio: ["ignore", "ignore", "pipe"],
			env: {
				// biome-ignore lint/style/noProcessEnv: the child inherits the whole environment, no value is read here
				...(process.env as Record<string, string>),
				...(env ?? {}),
			},
		});
		const server: LocalServer = { child, stderr: "" };
		child.stderr?.on("data", (chunk: Buffer) => {
			server.stderr = (server.stderr + chunk.toString()).slice(-STDERR_KEEP);
		});
		child.on("error", (err) => {
			server.stderr += `\n${err.message}`;
		});
		child.unref();
		return server;
	}
}
