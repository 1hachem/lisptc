import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { stateEntries } from "./mcp-server-resource.ts";
import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
	StartWatch,
} from "./ports.ts";
import { reachable, START_LIMITS, waitForStart } from "./start-wait.ts";

const STDERR_KEEP = 4096;

interface LocalServer {
	child: ReturnType<typeof spawn>;
	stderr: string;
}

function whyItDied(server: LocalServer): string {
	const tail = server.stderr.trim().split("\n").slice(-6).join("\n");
	return tail ? `\n${tail}` : "";
}

export function localStateArgs(
	conf: ConnConfig,
	stateHome: string,
	scope?: string,
): string[] {
	const args = conf.args ?? [];
	if (!("image" in conf)) return args;
	const states = stateEntries(conf.state);
	return states.reduce((rewritten, state) => {
		const dir = join(stateHome, scope ?? "", conf.name, state.name);
		mkdirSync(dir, { recursive: true });
		return rewritten.map((arg) => arg.replaceAll(state.path, dir));
	}, args);
}

export class LocalProcessHost implements McpHost {
	private readonly started = new Map<string, LocalServer>();

	async ensure(
		conf: ConnConfig,
		watch?: StartWatch,
	): Promise<ServerHandle | undefined> {
		if ("image" in conf && conf.app)
			throw new Error(
				`${conf.name}: runs an app beside it, which needs a container host (docker or kubernetes), not a local process.`,
			);
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
		const started = server;
		return await waitForStart(
			async () => {
				if (await reachable(origin)) return { ready: handle };
				if (started.child.exitCode !== null) {
					this.started.delete(conf.name);
					throw new Error(
						`${conf.name}: its server exited with code ${started.child.exitCode} before ${origin} answered.${whyItDied(started)}`,
					);
				}
				return { waiting: `${conf.name} is waiting for ${origin} to answer` };
			},
			START_LIMITS.process,
			({ seconds }) =>
				new Error(
					`${conf.name}: started its server but ${origin} did not answer within ${seconds}s.${whyItDied(started)}`,
				),
			watch,
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

	used(_name: string): void {}

	async asleep(_name: string): Promise<boolean> {
		return false;
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
