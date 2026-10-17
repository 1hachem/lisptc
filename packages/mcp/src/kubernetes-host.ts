import {
	ApiException,
	CustomObjectsApi,
	KubeConfig,
	PatchStrategy,
	setHeaderOptions,
} from "@kubernetes/client-node";
import { launchFor } from "./docker-host.ts";
import { LocalProcessHost } from "./local-host.ts";
import {
	GROUP,
	KIND,
	type McpServer,
	type McpServerSpec,
	type McpServerStatus,
	PLURAL,
	retagged,
	type State,
	serverName,
	specFor,
	VERSION,
} from "./mcp-server-resource.ts";
import {
	type ConnConfig,
	type HeldState,
	logTail,
	type McpHost,
	type ServerHandle,
	type ServerState,
	type StartWatch,
} from "./ports.ts";
import {
	START_LIMITS,
	type StartCheck,
	type StartGaveUp,
	type StartLimits,
	waitForStart,
} from "./start-wait.ts";

const TOUCH_SECONDS = 60;
const PROBE_TIMEOUT_MS = 3_000;

export interface ServerStore {
	get(name: string): Promise<McpServer | undefined>;
	create(server: McpServer): Promise<McpServer>;
	patchSpec(name: string, spec: Partial<McpServerSpec>): Promise<McpServer>;
}

export interface KubernetesHostOptions {
	scope: string;
	namespace: string;
	store?: ServerStore;
	fallback?: McpHost;
	clock?: () => number;
	limits?: StartLimits;
	imageTag?: string;
}

class Start {
	note: string | undefined;
	waiting = 0;
	readonly listeners = new Set<(note: string) => void>();
	readonly controller = new AbortController();
	readonly run: Promise<ServerHandle>;

	constructor(serve: (watch: StartWatch) => Promise<ServerHandle>) {
		this.run = serve({
			signal: this.controller.signal,
			progress: (note) => {
				this.note = note;
				for (const listener of this.listeners) listener(note);
			},
		});
	}
}

function abandoned(signal: AbortSignal | undefined): Promise<never> {
	return new Promise((_, reject) => {
		if (!signal) return;
		if (signal.aborted) reject(signal.reason);
		else
			signal.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
	});
}

interface Followed {
	name: string;
	state: ServerState;
	logs: string;
	touched: number;
}

function epochSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function isStatus(ex: unknown, code: number): boolean {
	return ex instanceof ApiException && ex.code === code;
}

function keepManual(wanted: State[], live: State[] | undefined): State[] {
	return wanted.map((state) => {
		const kept = live?.find((entry) => entry.name === state.name);
		return kept ? { ...state, size: kept.size, reset: kept.reset } : state;
	});
}

export function respecced(
	live: McpServerSpec,
	wanted: McpServerSpec,
	failed: boolean,
): McpServerSpec {
	return {
		...wanted,
		mcp: { ...wanted.mcp, state: keepManual(wanted.mcp.state, live.mcp.state) },
		...(wanted.app
			? {
					app: {
						...wanted.app,
						state: keepManual(wanted.app.state, live.app?.state),
					},
				}
			: {}),
		restarts: live.restarts + (failed ? 1 : 0),
		idleSeconds: live.idleSeconds,
	};
}

function defaultConfig(): KubeConfig {
	const config = new KubeConfig();
	config.loadFromDefault();
	return config;
}

const merge = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);

export function clientStore(
	namespace: string,
	config: KubeConfig = defaultConfig(),
): ServerStore {
	const custom = config.makeApiClient(CustomObjectsApi);
	const target = { group: GROUP, version: VERSION, namespace, plural: PLURAL };
	return {
		async get(name) {
			try {
				return (await custom.getNamespacedCustomObject({
					...target,
					name,
				})) as McpServer;
			} catch (ex) {
				if (isStatus(ex, 404)) return undefined;
				throw ex;
			}
		},
		async create(body) {
			return (await custom.createNamespacedCustomObject({
				...target,
				body,
			})) as McpServer;
		},
		async patchSpec(name, spec) {
			return (await custom.patchNamespacedCustomObject(
				{ ...target, name, body: { spec } },
				merge,
			)) as McpServer;
		},
	};
}

export async function clusterServes(
	namespace: string | undefined,
	config: KubeConfig = defaultConfig(),
): Promise<true> {
	if (namespace === undefined)
		throw new Error(
			"no namespace to run MCP servers in: LISPTC_MCP_NAMESPACE is not set.",
		);
	const resource = `${PLURAL}.${GROUP}/${VERSION}`;
	const served = config
		.makeApiClient(CustomObjectsApi)
		.listNamespacedCustomObject({
			group: GROUP,
			version: VERSION,
			namespace,
			plural: PLURAL,
			limit: 1,
		});
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(
			() =>
				reject(
					new Error(
						`the cluster did not list ${resource} in ${namespace} within ${PROBE_TIMEOUT_MS / 1000}s.`,
					),
				),
			PROBE_TIMEOUT_MS,
		).unref(),
	);
	try {
		await Promise.race([served, timeout]);
		return true;
	} catch (cause) {
		if (cause instanceof ApiException && cause.code === 404)
			throw new Error(
				`the cluster does not serve ${resource}: its CustomResourceDefinition is not installed.`,
				{ cause },
			);
		if (cause instanceof ApiException && cause.code === 403)
			throw new Error(
				`this service account may not list ${resource} in ${namespace}.`,
				{ cause },
			);
		throw cause;
	}
}

export class KubernetesHost implements McpHost {
	private readonly followed = new Map<string, Followed>();
	private readonly starting = new Map<string, Start>();
	private readonly store: ServerStore;
	private readonly fallback: McpHost;
	private readonly clock: () => number;
	private readonly limits: StartLimits;

	constructor(private readonly options: KubernetesHostOptions) {
		this.store = options.store ?? clientStore(options.namespace);
		this.fallback = options.fallback ?? new LocalProcessHost();
		this.clock = options.clock ?? epochSeconds;
		this.limits = options.limits ?? START_LIMITS.cluster;
	}

	async ensure(
		conf: ConnConfig,
		watch: StartWatch = {},
	): Promise<ServerHandle | undefined> {
		if (launchFor(conf) === undefined)
			return await this.fallback.ensure(conf, watch);
		const start = this.starting.get(conf.name) ?? this.begin(conf);
		return await this.join(start, watch);
	}

	private begin(conf: ConnConfig): Start {
		const start = new Start((watch) =>
			this.serving(conf, watch).finally(() => this.starting.delete(conf.name)),
		);
		start.run.catch(() => {});
		this.starting.set(conf.name, start);
		return start;
	}

	private async join(start: Start, watch: StartWatch): Promise<ServerHandle> {
		const { signal, progress } = watch;
		if (progress) {
			start.listeners.add(progress);
			if (start.note) progress(start.note);
		}
		start.waiting += 1;
		const leave = () => {
			start.waiting -= 1;
			if (start.waiting === 0) start.controller.abort(signal?.reason);
		};
		signal?.addEventListener("abort", leave, { once: true });
		try {
			return await Promise.race([start.run, abandoned(signal)]);
		} finally {
			signal?.removeEventListener("abort", leave);
			if (progress) start.listeners.delete(progress);
		}
	}

	async stop(name: string): Promise<void> {
		await this.starting.get(name)?.run.catch(() => {});
		const followed = this.followed.get(name);
		if (!followed) return await this.fallback.stop(name);
		this.unfollow(followed);
		await this.store.patchSpec(followed.name, { lastUsed: 0 });
	}

	async stopAll(): Promise<void> {
		await Promise.allSettled(
			[...this.starting.values()].map((start) => start.run),
		);
		const running = [...this.followed.values()].filter(
			(followed) => followed.state === "running",
		);
		for (const followed of this.followed.values()) this.unfollow(followed);
		await Promise.allSettled(
			running.map((followed) =>
				this.store.patchSpec(followed.name, { lastUsed: 0 }),
			),
		);
		await this.fallback.stopAll();
	}

	status(name: string): ServerState {
		const followed = this.followed.get(name);
		return followed ? followed.state : this.fallback.status(name);
	}

	logs(name: string): string {
		const followed = this.followed.get(name);
		return followed ? followed.logs : this.fallback.logs(name);
	}

	used(name: string): void {
		const followed = this.followed.get(name);
		if (!followed) {
			this.fallback.used(name);
			return;
		}
		const now = this.clock();
		if (followed.state !== "running" || now - followed.touched < TOUCH_SECONDS)
			return;
		followed.touched = now;
		this.store.patchSpec(followed.name, { lastUsed: now }).catch(() => {});
	}

	async phase(name: string): Promise<HeldState> {
		const followed = this.followed.get(name);
		if (!followed) return await this.fallback.phase(name);
		const held = heldState(await this.store.get(followed.name), this.clock());
		if (held.phase !== "ready") this.unfollow(followed);
		return held;
	}

	private unfollow(followed: Followed): void {
		followed.state = "stopped";
	}

	private async serving(
		conf: ConnConfig,
		watch: StartWatch,
	): Promise<ServerHandle> {
		const launch = launchFor(conf);
		if (!launch) throw new Error(`${conf.name}: has no container to run.`);
		const { scope } = this.options;
		if (Object.keys(("env" in conf && conf.env) || {}).length > 0)
			throw new Error(
				`${conf.name}: sets env, which a server on the cluster cannot take.`,
			);
		const name = serverName(scope, conf.name);
		const wanted = specFor(
			conf,
			"internal" in conf && conf.internal
				? { ...launch, image: retagged(launch.image, this.options.imageTag) }
				: launch,
			scope,
			this.clock(),
		);

		const live = await this.store.get(name);
		const server = live
			? await this.store.patchSpec(
					name,
					respecced(live.spec, wanted, live.status?.phase === "Failed"),
				)
			: await this.store.create({
					apiVersion: `${GROUP}/${VERSION}`,
					kind: KIND,
					metadata: { name },
					spec: wanted,
				});

		const followed: Followed = this.followed.get(conf.name) ?? {
			name,
			state: "running",
			logs: "",
			touched: 0,
		};
		this.followed.set(conf.name, followed);
		const url = await this.answering(conf.name, server, followed, watch);
		this.follow(followed);
		const headers = "headers" in conf ? conf.headers : undefined;
		return headers ? { url, headers } : { url };
	}

	private async answering(
		label: string,
		asked: McpServer,
		followed: Followed,
		watch: StartWatch,
	): Promise<string> {
		const generation = asked.metadata.generation ?? 0;
		try {
			return await waitForStart<string>(
				async () => {
					const live = await this.store.get(asked.metadata.name);
					const status = live?.status ?? {};
					if ((status.observedGeneration ?? 0) < generation)
						return { waiting: `${label} is starting on the cluster` };
					return standing(label, status, followed);
				},
				this.limits,
				(why) => clusterGaveUp(label, why),
				watch,
			);
		} catch (ex) {
			followed.state = "stopped";
			throw ex;
		}
	}

	private follow(followed: Followed): void {
		followed.state = "running";
		followed.touched = this.clock();
	}
}

function standing(
	label: string,
	status: McpServerStatus,
	followed: Followed,
): StartCheck<string> {
	const mcp = status.endpoints?.mcp;
	if (status.phase === "Ready" && mcp) return { ready: mcp };
	if (status.phase === "Failed") {
		followed.logs = status.logTail ?? "";
		throw new Error(
			`${label}: ${status.reason ?? "its server failed"} before it answered.${tail(followed.logs)}`,
		);
	}
	const phase = (status.phase ?? "Starting").toLowerCase();
	const reason = status.reason ? `: ${status.reason}` : "";
	return { waiting: `${label} is ${phase} on the cluster${reason}` };
}

function clusterGaveUp(label: string, why: StartGaveUp): Error {
	return new Error(
		why.stalled
			? `${label}: the cluster made no progress for ${why.seconds}s, so it was given up on (${why.note}).`
			: `${label}: the cluster did not have it answering within ${why.seconds}s (${why.note}).`,
	);
}

function tail(logs: string): string {
	const last = logTail(logs);
	return last ? `\n${last}` : "";
}

function heldState(live: McpServer | undefined, now: number): HeldState {
	if (live === undefined) return { phase: "gone" };
	const { spec, status } = live;
	if (status?.phase === "Failed") {
		const reason = status.reason ?? logTail(status.logTail ?? "");
		return reason === "" ? { phase: "failed" } : { phase: "failed", reason };
	}
	if (status?.phase === "Sleeping" || now - spec.lastUsed >= spec.idleSeconds)
		return { phase: "sleeping" };
	return { phase: "ready" };
}
