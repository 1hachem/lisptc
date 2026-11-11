import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { RunSpec } from "./launch.ts";
import {
	reachable,
	START_LIMITS,
	type Watch,
	waitForStart,
} from "./start-wait.ts";

const exec = promisify(execFile);

const LOGS_KEEP = 8192;
const PROBE_TIMEOUT_MS = 5_000;

const HOST_LABEL = "lisptc.mcp.host";
const SERVER_LABEL = "lisptc.mcp.server";

export interface RunningContainer {
	readonly url: string;
	logs(): string;
	stop(): Promise<void>;
}

export type ContainerExited = (reason: string) => void;

interface Tail {
	logs: string;
	running: boolean;
	stopping: boolean;
}

function whyItDied(tail: Tail): string {
	const last = tail.logs.trim().split("\n").slice(-6).join("\n");
	return last ? `\n${last}` : "";
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

export class DockerRunner {
	private readonly hostId = randomUUID();

	async run(
		spec: RunSpec,
		exited: ContainerExited,
		watch?: Watch,
	): Promise<RunningContainer> {
		const { name, launch, app } = spec;
		const exposed = (app?.ports ?? []).filter((port) =>
			app?.expose?.includes(port.name),
		);
		const id = await this.docker(name, [
			"run",
			"--detach",
			"--init",
			"--shm-size=1g",
			...(app ? ["--ipc", "shareable"] : []),
			...this.labels(name),
			"--publish",
			`127.0.0.1::${launch.exposed}`,
			...exposed.flatMap((port) => ["--publish", `127.0.0.1::${port.port}`]),
			...envFlags(spec),
			launch.image,
			...launch.args,
		]);
		const tail: Tail = { logs: "", running: true, stopping: false };
		let appId: string | undefined;
		const stop = async () => {
			tail.stopping = true;
			if (appId) await discard(appId);
			await discard(id);
		};
		this.follow(id, tail, exited);
		try {
			if (app)
				appId = await this.docker(name, [
					"run",
					"--detach",
					"--init",
					"--network",
					`container:${id}`,
					"--ipc",
					`container:${id}`,
					...this.labels(name),
					...envFlags(spec),
					app.image,
					...(app.args ?? []),
				]);
			const published = await this.publishedPort(name, id, launch.exposed);
			const url = new URL(launch.path, `http://${published}`).toString();
			await answering(name, tail, new URL(url).origin, watch);
			return { url, logs: () => tail.logs, stop };
		} catch (ex) {
			await stop();
			throw ex;
		}
	}

	async reap(): Promise<void> {
		const found = await exec("docker", [
			"ps",
			"--all",
			"--quiet",
			"--filter",
			`label=${HOST_LABEL}=${this.hostId}`,
		]).catch(() => undefined);
		const ids = found?.stdout.trim().split("\n").filter(Boolean) ?? [];
		for (const id of ids) await discard(id);
	}

	private labels(name: string): string[] {
		return [
			"--label",
			`${HOST_LABEL}=${this.hostId}`,
			"--label",
			`${SERVER_LABEL}=${name}`,
		];
	}

	private follow(id: string, tail: Tail, exited: ContainerExited): void {
		const logs = spawn("docker", ["logs", "--follow", id], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const append = (chunk: Buffer) => {
			tail.logs = (tail.logs + chunk.toString()).slice(-LOGS_KEEP);
		};
		logs.stdout?.on("data", append);
		logs.stderr?.on("data", append);
		logs.on("error", (err) => {
			tail.logs += `\n${err.message}`;
		});
		logs.on("close", () => {
			tail.running = false;
			if (!tail.stopping) exited(`its container exited.${whyItDied(tail)}`);
		});
		logs.unref();
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

	private async docker(name: string, args: string[]): Promise<string> {
		try {
			const { stdout } = await exec("docker", args);
			return stdout.trim();
		} catch (ex) {
			const detail =
				ex instanceof Error && "stderr" in ex
					? String((ex as { stderr: unknown }).stderr).trim()
					: String(ex);
			throw new Error(`${name}: docker ${args[0]} failed.\n${detail}`);
		}
	}
}

function envFlags({ env, secret }: RunSpec): string[] {
	return [
		...Object.entries(env ?? {}).flatMap(([name, value]) => [
			"--env",
			`${name}=${value}`,
		]),
		...(secret?.keys ?? []).flatMap((name) => ["--env", name]),
	];
}

async function answering(
	name: string,
	tail: Tail,
	origin: string,
	watch?: Watch,
): Promise<void> {
	await waitForStart(
		async () => {
			if (await reachable(origin)) return { ready: undefined };
			if (!tail.running)
				throw new Error(
					`${name}: its container exited before ${origin} answered.${whyItDied(tail)}`,
				);
			return { waiting: `${name} is waiting for ${origin} to answer` };
		},
		START_LIMITS.docker,
		({ seconds }) =>
			new Error(
				`${name}: started its container but ${origin} did not answer within ${seconds}s.${whyItDied(tail)}`,
			),
		watch,
	);
}

async function discard(id: string): Promise<void> {
	await exec("docker", ["stop", id]).catch(() => {});
	await exec("docker", ["rm", "--force", "--volumes", id]).catch(() => {});
}
