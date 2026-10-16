import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { LocalProcessHost } from "./local-host.ts";
import {
	dnsLabel,
	type Launch,
	type State,
	stateEntries,
} from "./mcp-server-resource.ts";
import {
	type ConnConfig,
	type HeldState,
	logTail,
	type McpHost,
	type ServerHandle,
	type ServerReporter,
	type ServerState,
	type StartWatch,
	stillHeld,
} from "./ports.ts";
import { reachable, START_LIMITS, waitForStart } from "./start-wait.ts";

const exec = promisify(execFile);

const LOGS_KEEP = 8192;
const PROBE_TIMEOUT_MS = 5_000;

const GATEWAY_IMAGE = "supercorp/supergateway:3.4.3";
const GATEWAY_PORT = "8000";
const MCP_PATH = "/mcp";

const HOST_LABEL = "lisptc.mcp.host";
const SERVER_LABEL = "lisptc.mcp.server";
export const STATE_LABEL = "lisptc.mcp.state";

interface Container {
	id: string;
	appId?: string;
	handle: ServerHandle;
	logs: string;
	state: ServerState;
}

function whyItDied(container: Container): string {
	const tail = logTail(container.logs);
	return tail ? `\n${tail}` : "";
}

function exited(container: Container): HeldState {
	const reason = logTail(container.logs);
	return reason === "" ? { phase: "failed" } : { phase: "failed", reason };
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

export async function dockerAnswers(): Promise<boolean> {
	try {
		await exec("docker", ["info", "--format", "{{.ServerVersion}}"], {
			timeout: PROBE_TIMEOUT_MS,
		});
		return true;
	} catch {
		return false;
	}
}

export class DockerHost implements McpHost {
	private readonly containers = new Map<string, Container>();
	private readonly ended = new Map<string, HeldState>();
	private readonly instance = randomUUID();

	constructor(
		private readonly fallback: McpHost = new LocalProcessHost(),
		private readonly scope = "local",
		private readonly report: ServerReporter = () => {},
	) {}

	async ensure(
		conf: ConnConfig,
		watch?: StartWatch,
	): Promise<ServerHandle | undefined> {
		const launch = launchFor(conf);
		if (launch === undefined) return await this.fallback.ensure(conf, watch);
		const running = this.containers.get(conf.name);
		if (running && running.state === "running") return running.handle;
		return await this.start(conf, launch, watch);
	}

	async stop(name: string): Promise<void> {
		const container = this.containers.get(name);
		if (!container) return await this.fallback.stop(name);
		this.containers.delete(name);
		this.ended.set(name, { phase: "sleeping" });
		if (container.appId) await this.remove(container.appId);
		await this.remove(container.id);
		this.report({ server: name, phase: "sleeping" });
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

	used(name: string): void {
		if (!this.containers.has(name)) this.fallback.used(name);
	}

	async phase(name: string): Promise<HeldState> {
		const container = this.containers.get(name);
		if (container === undefined)
			return this.ended.get(name) ?? (await this.fallback.phase(name));
		return container.state === "running" ? stillHeld : exited(container);
	}

	private labels(conf: ConnConfig): string[] {
		return [
			"--label",
			`${HOST_LABEL}=${this.instance}`,
			"--label",
			`${SERVER_LABEL}=${conf.name}`,
		];
	}

	private mounts(conf: ConnConfig, states: State[]): string[] {
		return states.flatMap((state) => [
			"--mount",
			`type=volume,src=${volumeName(this.scope, conf.name, state.name)},dst=${state.path},volume-label=${STATE_LABEL}=${dnsLabel(this.scope)}`,
		]);
	}

	private envFlags(conf: ConnConfig): string[] {
		const passed = "secret" in conf && conf.secret ? conf.secret.keys : [];
		return [
			...Object.entries(conf.env ?? {}).flatMap(([name, value]) => [
				"--env",
				`${name}=${value}`,
			]),
			...passed.flatMap((name) => ["--env", name]),
		];
	}

	private async start(
		conf: ConnConfig,
		launch: Launch,
		watch?: StartWatch,
	): Promise<ServerHandle> {
		this.ended.delete(conf.name);
		this.report({ server: conf.name, phase: "starting" });
		try {
			watch?.progress?.(`${conf.name} is starting its container`);
			const handle = await this.launch(conf, launch, watch);
			this.report({ server: conf.name, phase: "ready" });
			return handle;
		} catch (ex) {
			this.report({
				server: conf.name,
				phase: "failed",
				reason: ex instanceof Error ? ex.message : String(ex),
			});
			throw ex;
		}
	}

	private async launch(
		conf: ConnConfig,
		launch: Launch,
		watch?: StartWatch,
	): Promise<ServerHandle> {
		const app = "app" in conf ? conf.app : undefined;
		const exposed = (app?.ports ?? []).filter((port) =>
			app?.expose?.includes(port.name),
		);
		const args = [
			"run",
			"--detach",
			"--init",
			"--shm-size=1g",
			...(app ? ["--ipc", "shareable"] : []),
			...this.labels(conf),
			"--publish",
			`127.0.0.1::${launch.exposed}`,
			...exposed.flatMap((port) => ["--publish", `127.0.0.1::${port.port}`]),
			...this.mounts(
				conf,
				stateEntries("state" in conf ? conf.state : undefined),
			),
			...this.envFlags(conf),
			launch.image,
			...launch.args,
		];

		const id = await this.docker(conf.name, args);
		const container: Container = {
			id,
			handle: { url: launch.path },
			logs: "",
			state: "running",
		};
		this.follow(conf.name, container);
		try {
			if (app)
				container.appId = await this.docker(conf.name, [
					"run",
					"--detach",
					"--init",
					"--network",
					`container:${id}`,
					"--ipc",
					`container:${id}`,
					...this.labels(conf),
					...this.mounts(conf, stateEntries(app.state)),
					...this.envFlags(conf),
					app.image,
					...(app.args ?? []),
				]);
			const published = await this.publishedPort(conf.name, id, launch.exposed);
			const url = new URL(launch.path, `http://${published}`).toString();
			const headers = "headers" in conf ? conf.headers : undefined;
			container.handle = headers ? { url, headers } : { url };
			this.containers.set(conf.name, container);
			await this.answering(conf.name, container, new URL(url).origin, watch);
			return container.handle;
		} catch (ex) {
			this.containers.delete(conf.name);
			if (container.appId) await this.remove(container.appId);
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
		watch?: StartWatch,
	): Promise<void> {
		await waitForStart(
			async () => {
				if (await reachable(origin)) return { ready: undefined };
				if (container.state !== "running")
					throw new Error(
						`${name}: its container exited before ${origin} answered.${whyItDied(container)}`,
					);
				return { waiting: `${name} is waiting for ${origin} to answer` };
			},
			START_LIMITS.docker,
			({ seconds }) =>
				new Error(
					`${name}: started its container but ${origin} did not answer within ${seconds}s.${whyItDied(container)}`,
				),
			watch,
		);
	}

	private follow(name: string, container: Container): void {
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
			if (this.containers.get(name) !== container) return;
			this.containers.delete(name);
			this.ended.set(name, exited(container));
			this.report({
				server: name,
				phase: "failed",
				reason: `its container exited.${whyItDied(container)}`,
			});
		});
		tail.unref();
	}

	private async remove(id: string): Promise<void> {
		await exec("docker", ["stop", id]).catch(() => {});
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

export function volumeName(scope: string, server: string, state: string) {
	return `lisptc-${dnsLabel(scope, 24)}-${dnsLabel(server, 24)}-${state}`;
}
