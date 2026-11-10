import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { type Launch, launchFor } from "./launch.ts";
import {
	type ConnConfig,
	type McpHost,
	refKey,
	refOf,
	type ServerHandle,
	type ServerRef,
	type ServerReporter,
	type ServerState,
	type StartWatch,
	subjectOf,
} from "./ports.ts";
import { reachable, START_LIMITS, waitForStart } from "./start-wait.ts";

const exec = promisify(execFile);

const LOGS_KEEP = 8192;
const PROBE_TIMEOUT_MS = 5_000;

const HOST_LABEL = "lisptc.mcp.host";
const SERVER_LABEL = "lisptc.mcp.server";

interface Container {
	server: ServerRef;
	id: string;
	appId?: string;
	handle: ServerHandle;
	logs: string;
	state: ServerState;
}

function whyItDied(container: Container): string {
	const tail = container.logs.trim().split("\n").slice(-6).join("\n");
	return tail ? `\n${tail}` : "";
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
	private readonly hostId = randomUUID();

	constructor(private readonly report: ServerReporter = () => {}) {}

	async ensure(conf: ConnConfig, watch?: StartWatch): Promise<ServerHandle> {
		const launch = launchFor(conf);
		if (launch === undefined)
			throw new Error(`${conf.name}: has no container to run.`);
		const running = this.containers.get(refKey(conf));
		if (running && running.state === "running") return running.handle;
		return await this.start(conf, launch, watch);
	}

	async stop(server: ServerRef): Promise<void> {
		if (await this.drop(server))
			this.report({ ...subjectOf(server), phase: "sleeping" });
	}

	async remove(conf: ConnConfig): Promise<void> {
		await this.drop(conf);
		this.report({ ...subjectOf(conf), phase: "gone" });
	}

	private async drop(server: ServerRef): Promise<boolean> {
		const container = this.containers.get(refKey(server));
		if (!container) return false;
		this.containers.delete(refKey(server));
		if (container.appId) await this.discard(container.appId);
		await this.discard(container.id);
		return true;
	}

	async stopAll(): Promise<void> {
		for (const { server } of [...this.containers.values()])
			await this.stop(server);
		await this.reapStrays();
	}

	status(server: ServerRef): ServerState {
		return this.containers.get(refKey(server))?.state ?? "unknown";
	}

	logs(server: ServerRef): string {
		return this.containers.get(refKey(server))?.logs ?? "";
	}

	used(_server: ServerRef): void {}

	async asleep(_server: ServerRef): Promise<boolean> {
		return false;
	}

	private labels(conf: ConnConfig): string[] {
		return [
			"--label",
			`${HOST_LABEL}=${this.hostId}`,
			"--label",
			`${SERVER_LABEL}=${conf.name}`,
		];
	}

	private envFlags(conf: ConnConfig): string[] {
		const passed = "secret" in conf && conf.secret ? conf.secret.keys : [];
		return [
			...Object.entries(("env" in conf && conf.env) || {}).flatMap(
				([name, value]) => ["--env", `${name}=${value}`],
			),
			...passed.flatMap((name) => ["--env", name]),
		];
	}

	private async start(
		conf: ConnConfig,
		launch: Launch,
		watch?: StartWatch,
	): Promise<ServerHandle> {
		this.report({ ...subjectOf(conf), phase: "starting" });
		try {
			watch?.progress?.(`${conf.name} is starting its container`);
			const handle = await this.launch(conf, launch, watch);
			this.report({ ...subjectOf(conf), phase: "ready" });
			return handle;
		} catch (ex) {
			this.report({
				...subjectOf(conf),
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
			...this.envFlags(conf),
			launch.image,
			...launch.args,
		];

		const id = await this.docker(conf.name, args);
		const container: Container = {
			server: refOf(conf),
			id,
			handle: { url: launch.path },
			logs: "",
			state: "running",
		};
		this.follow(container);
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
					...this.envFlags(conf),
					app.image,
					...(app.args ?? []),
				]);
			const published = await this.publishedPort(conf.name, id, launch.exposed);
			const url = new URL(launch.path, `http://${published}`).toString();
			const headers = "headers" in conf ? conf.headers : undefined;
			container.handle = headers ? { url, headers } : { url };
			this.containers.set(refKey(conf), container);
			await this.answering(conf.name, container, new URL(url).origin, watch);
			return container.handle;
		} catch (ex) {
			this.containers.delete(refKey(conf));
			if (container.appId) await this.discard(container.appId);
			await this.discard(id);
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

	private follow(container: Container): void {
		const key = refKey(container.server);
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
			if (this.containers.get(key) !== container) return;
			this.containers.delete(key);
			this.report({
				...subjectOf(container.server),
				phase: "failed",
				reason: `its container exited.${whyItDied(container)}`,
			});
		});
		tail.unref();
	}

	private async discard(id: string): Promise<void> {
		await exec("docker", ["stop", id]).catch(() => {});
		await exec("docker", ["rm", "--force", "--volumes", id]).catch(() => {});
	}

	private async reapStrays(): Promise<void> {
		const found = await exec("docker", [
			"ps",
			"--all",
			"--quiet",
			"--filter",
			`label=${HOST_LABEL}=${this.hostId}`,
		]).catch(() => undefined);
		const ids = found?.stdout.trim().split("\n").filter(Boolean) ?? [];
		for (const id of ids) await this.discard(id);
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
