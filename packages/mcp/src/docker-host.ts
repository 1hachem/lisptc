import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { LocalProcessHost } from "./local-host.ts";
import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
} from "./ports.ts";

const exec = promisify(execFile);

const START_TIMEOUT_MS = 120_000;
const POLL_MS = 250;
const LOGS_KEEP = 8192;

const GATEWAY_IMAGE = "supercorp/supergateway:3.4.3";
const GATEWAY_PORT = "8000";
const MCP_PATH = "/mcp";

const HOST_LABEL = "lisptc.mcp.host";
const SERVER_LABEL = "lisptc.mcp.server";

interface Container {
	id: string;
	handle: ServerHandle;
	logs: string;
	state: ServerState;
}

export interface Launch {
	image: string;
	exposed: string;
	path: string;
	args: string[];
}

async function reachable(url: string): Promise<boolean> {
	try {
		await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
		return true;
	} catch {
		return false;
	}
}

function whyItDied(container: Container): string {
	const tail = container.logs.trim().split("\n").slice(-6).join("\n");
	return tail ? `\n${tail}` : "";
}

function shellQuote(word: string): string {
	return /^[\w@%+=:,./-]+$/.test(word)
		? word
		: `'${word.replaceAll("'", `'\\''`)}'`;
}

function stdioCommand(conf: ConnConfig): string {
	const command = "command" in conf ? conf.command : undefined;
	if (command === undefined) return "";
	return [command, ...(conf.args ?? [])].map(shellQuote).join(" ");
}

export function launchFor(conf: ConnConfig): Launch | undefined {
	if ("image" in conf)
		return {
			image: conf.image,
			exposed: String(conf.port),
			path: conf.path ?? MCP_PATH,
			args: conf.command ? [] : (conf.args ?? []),
		};
	if ("url" in conf) return undefined;
	return {
		image: GATEWAY_IMAGE,
		exposed: GATEWAY_PORT,
		path: MCP_PATH,
		args: [
			"--stdio",
			stdioCommand(conf),
			"--outputTransport",
			"streamableHttp",
			"--stateful",
			"--port",
			GATEWAY_PORT,
			"--streamableHttpPath",
			MCP_PATH,
		],
	};
}

export class DockerHost implements McpHost {
	private readonly containers = new Map<string, Container>();
	private readonly instance = randomUUID();

	constructor(private readonly fallback: McpHost = new LocalProcessHost()) {}

	async ensure(conf: ConnConfig): Promise<ServerHandle | undefined> {
		const launch = launchFor(conf);
		if (launch === undefined) return await this.fallback.ensure(conf);
		const running = this.containers.get(conf.name);
		if (running && running.state === "running") return running.handle;
		return await this.start(conf, launch);
	}

	async stop(name: string): Promise<void> {
		const container = this.containers.get(name);
		if (!container) return await this.fallback.stop(name);
		this.containers.delete(name);
		await this.remove(container.id);
	}

	async stopAll(): Promise<void> {
		for (const name of [...this.containers.keys()]) await this.stop(name);
		await this.fallback.stopAll();
		await this.reapStrays();
	}

	status(name: string): ServerState {
		const container = this.containers.get(name);
		return container ? container.state : this.fallback.status(name);
	}

	logs(name: string): string {
		const container = this.containers.get(name);
		return container ? container.logs : this.fallback.logs(name);
	}

	private async start(conf: ConnConfig, launch: Launch): Promise<ServerHandle> {
		const args = [
			"run",
			"--detach",
			"--init",
			"--shm-size=1g",
			"--label",
			`${HOST_LABEL}=${this.instance}`,
			"--label",
			`${SERVER_LABEL}=${conf.name}`,
			"--publish",
			`127.0.0.1::${launch.exposed}`,
		];
		for (const [name, value] of Object.entries(conf.env ?? {}))
			args.push("--env", `${name}=${value}`);
		args.push(launch.image, ...launch.args);

		const id = await this.docker(conf.name, args);
		const container: Container = {
			id,
			handle: { url: launch.path },
			logs: "",
			state: "running",
		};
		this.follow(container);
		try {
			const published = await this.publishedPort(conf.name, id, launch.exposed);
			const url = new URL(launch.path, `http://${published}`).toString();
			const headers = "headers" in conf ? conf.headers : undefined;
			container.handle = headers ? { url, headers } : { url };
			this.containers.set(conf.name, container);
			await this.answering(conf.name, container, new URL(url).origin);
			return container.handle;
		} catch (ex) {
			this.containers.delete(conf.name);
			await this.remove(id);
			throw ex;
		}
	}

	private async publishedPort(
		name: string,
		id: string,
		exposed: string,
	): Promise<string> {
		const mapped = await this.docker(name, ["port", id, exposed]);
		const first = mapped.split("\n")[0]?.trim();
		if (!first)
			throw new Error(
				`${name}: its container published no address for port ${exposed}.`,
			);
		return first;
	}

	private async answering(
		name: string,
		container: Container,
		origin: string,
	): Promise<void> {
		const deadline = Date.now() + START_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (await reachable(origin)) return;
			if (container.state !== "running")
				throw new Error(
					`${name}: its container exited before ${origin} answered.${whyItDied(container)}`,
				);
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
		throw new Error(
			`${name}: started its container but ${origin} did not answer within ${START_TIMEOUT_MS / 1000}s.${whyItDied(container)}`,
		);
	}

	private follow(container: Container): void {
		const tail = spawn("docker", ["logs", "--follow", container.id], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const append = (chunk: Buffer) => {
			container.logs = (container.logs + chunk.toString()).slice(-LOGS_KEEP);
		};
		tail.stdout?.on("data", append);
		tail.stderr?.on("data", append);
		tail.on("error", (err) => {
			container.logs += `\n${err.message}`;
		});
		tail.on("close", () => {
			container.state = "stopped";
		});
		tail.unref();
	}

	private async remove(id: string): Promise<void> {
		await exec("docker", ["rm", "--force", "--volumes", id]).catch(() => {});
	}

	private async reapStrays(): Promise<void> {
		const found = await exec("docker", [
			"ps",
			"--all",
			"--quiet",
			"--filter",
			`label=${HOST_LABEL}=${this.instance}`,
		]).catch(() => undefined);
		const ids = found?.stdout.trim().split("\n").filter(Boolean) ?? [];
		for (const id of ids) await this.remove(id);
	}

	private async docker(name: string, args: string[]): Promise<string> {
		try {
			const { stdout } = await exec("docker", args);
			return stdout.trim();
		} catch (ex) {
			const detail =
				ex instanceof Error && "stderr" in ex
					? String((ex as { stderr: unknown }).stderr).trim()
					: String(ex);
			throw new Error(
				`${name}: docker ${args[0]} failed. Is the daemon reachable?\n${detail}`,
			);
		}
	}
}
