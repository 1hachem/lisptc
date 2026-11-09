import { spawn } from "node:child_process";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
	type ConnConfig,
	type HttpConnConfig,
	type McpHost,
	type McpTransport,
	refKey,
	refOf,
	type ServerHandle,
	type ServerRef,
	type ServerReporter,
	type ServerState,
	type StartWatch,
	subjectOf,
} from "./ports.ts";
import {
	type ReportedTransport,
	reportedTransport,
} from "./reported-transport.ts";
import { reachable, START_LIMITS, waitForStart } from "./start-wait.ts";

const STDERR_KEEP = 4096;

interface LocalServer {
	child: ReturnType<typeof spawn>;
	stderr: string;
	exited: boolean;
	ready: boolean;
}

type LaunchedConf = HttpConnConfig & { command: string };

interface Piped {
	readonly key: string;
	readonly reported: ReportedTransport;
}

function launched(conf: ConnConfig): conf is LaunchedConf {
	return "url" in conf && conf.command !== undefined;
}

function whyItDied(server: LocalServer): string {
	const tail = server.stderr.trim().split("\n").slice(-6).join("\n");
	return tail ? `\n${tail}` : "";
}

export class LocalProcessHost implements McpHost {
	private readonly started = new Map<string, LocalServer>();
	private readonly piped = new Set<Piped>();

	constructor(private readonly report: ServerReporter = () => {}) {}

	async ensure(conf: ConnConfig, watch?: StartWatch): Promise<ServerHandle> {
		if ("image" in conf && conf.app)
			throw new Error(
				`${conf.name}: runs an app beside it, which needs a container host (docker or kubernetes), not a local process.`,
			);
		if (!("url" in conf)) return this.pipe(conf);
		if (!launched(conf))
			throw new Error(`${conf.name}: is a remote server, not a local one.`);
		const handle: ServerHandle = conf.headers
			? { url: conf.url, headers: conf.headers }
			: { url: conf.url };
		const known = this.started.get(conf.name)?.ready === true;
		try {
			const ready = await this.start(conf, handle, watch);
			if (!known) this.report({ server: conf.name, phase: "ready" });
			return ready;
		} catch (ex) {
			this.report({
				server: conf.name,
				phase: "failed",
				reason: ex instanceof Error ? ex.message : String(ex),
			});
			throw ex;
		}
	}

	private async start(
		conf: LaunchedConf,
		handle: ServerHandle,
		watch?: StartWatch,
	): Promise<ServerHandle> {
		const origin = new URL(conf.url).origin;
		if (await reachable(origin)) return handle;
		let server = this.started.get(conf.name);
		if (!server || server.exited) {
			this.report({ server: conf.name, phase: "starting" });
			server = this.spawn(conf);
			this.started.set(conf.name, server);
		}
		const started = server;
		await waitForStart(
			async () => {
				if (await reachable(origin)) return { ready: undefined };
				if (started.exited) {
					if (this.started.get(conf.name) === started)
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
		started.ready = true;
		return handle;
	}

	private pipe(conf: Exclude<ConnConfig, HttpConnConfig>): ServerHandle {
		if (conf.command === undefined)
			throw new Error(
				`${conf.name}: runs as a container image and the host started none`,
			);
		const { command, args, env } = conf;
		const server = refOf(conf);
		return {
			transport: () => {
				const stdio = new StdioClientTransport({
					command,
					args: args ?? [],
					env: {
						// biome-ignore lint/style/noProcessEnv: the child inherits the whole environment, no value is read here
						...(process.env as Record<string, string>),
						...(env ?? {}),
					},
				});
				const piped: Piped = {
					key: refKey(server),
					reported: reportedTransport(
						server,
						stdio as unknown as McpTransport,
						this.report,
						() => this.piped.delete(piped),
					),
				};
				this.piped.add(piped);
				return piped.reported.transport;
			},
		};
	}

	async stop(server: ServerRef): Promise<void> {
		if (await this.drop(server))
			this.report({ ...subjectOf(server), phase: "sleeping" });
	}

	async remove(conf: ConnConfig): Promise<void> {
		await this.drop(conf);
		this.report({ ...subjectOf(conf), phase: "gone" });
	}

	private async drop(ref: ServerRef): Promise<boolean> {
		const server = this.started.get(ref.name);
		if (!server) return false;
		this.started.delete(ref.name);
		const { pid } = server.child;
		try {
			if (pid !== undefined) process.kill(-pid, "SIGTERM");
		} catch {
			server.child.kill("SIGTERM");
		}
		return true;
	}

	async stopAll(): Promise<void> {
		for (const name of [...this.started.keys()]) await this.stop({ name });
		await Promise.all([...this.piped].map((piped) => piped.reported.end()));
	}

	status(ref: ServerRef): ServerState {
		const key = refKey(ref);
		for (const piped of this.piped) if (piped.key === key) return "running";
		const server = this.started.get(ref.name);
		if (!server) return "unknown";
		return server.exited ? "stopped" : "running";
	}

	logs(server: ServerRef): string {
		return this.started.get(server.name)?.stderr ?? "";
	}

	used(_server: ServerRef): void {}

	async asleep(_server: ServerRef): Promise<boolean> {
		return false;
	}

	private spawn({ name, command, args, env }: LaunchedConf): LocalServer {
		const child = spawn(command, args ?? [], {
			detached: true,
			stdio: ["ignore", "ignore", "pipe"],
			env: {
				// biome-ignore lint/style/noProcessEnv: the child inherits the whole environment, no value is read here
				...(process.env as Record<string, string>),
				...(env ?? {}),
			},
		});
		const server: LocalServer = {
			child,
			stderr: "",
			exited: false,
			ready: false,
		};
		child.stderr?.on("data", (chunk: Buffer) => {
			server.stderr = (server.stderr + chunk.toString()).slice(-STDERR_KEEP);
		});
		child.on("error", (err) => {
			server.stderr += `\n${err.message}`;
		});
		child.on("close", (code, signal) => {
			server.exited = true;
			if (!server.ready || this.started.get(name) !== server) return;
			this.started.delete(name);
			this.report({
				server: name,
				phase: "failed",
				reason: `its process exited with ${signal ?? `code ${code}`}.${whyItDied(server)}`,
			});
		});
		child.unref();
		return server;
	}
}
