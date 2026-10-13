import {
	ApiException,
	CoreV1Api,
	CustomObjectsApi,
	KubeConfig,
	PatchStrategy,
	setHeaderOptions,
	type V1Secret,
} from "@kubernetes/client-node";
import { launchFor } from "./docker-host.ts";
import { LocalProcessHost } from "./local-host.ts";
import {
	envHash,
	GROUP,
	KIND,
	type McpServer,
	type McpServerSpec,
	PLURAL,
	type State,
	serverName,
	specFor,
	VERSION,
} from "./mcp-server-resource.ts";
import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
} from "./ports.ts";

const START_TIMEOUT_MS = 180_000;
const POLL_MS = 1_000;
const TOUCH_SECONDS = 60;
const PROBE_TIMEOUT_MS = 3_000;

export interface Owner {
	name: string;
	uid: string;
}

export interface ServerStore {
	get(name: string): Promise<McpServer | undefined>;
	create(server: McpServer): Promise<McpServer>;
	patchSpec(name: string, spec: Partial<McpServerSpec>): Promise<McpServer>;
	putEnv(
		name: string,
		data: Record<string, string>,
		owner?: Owner,
	): Promise<void>;
}

export interface KubernetesHostOptions {
	scope: string;
	namespace: string;
	store?: ServerStore;
	fallback?: McpHost;
	clock?: () => number;
	pollMs?: number;
	startTimeoutMs?: number;
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

function encoded(env: Record<string, string> | undefined) {
	return Object.fromEntries(
		Object.entries(env ?? {}).map(([key, value]) => [
			key,
			Buffer.from(value).toString("base64"),
		]),
	);
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

export function envSecretName(server: string): string {
	return `${server}-env`;
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
	const core = config.makeApiClient(CoreV1Api);
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
		async putEnv(name, data, owner) {
			const body: V1Secret = {
				metadata: {
					name,
					...(owner
						? {
								ownerReferences: [
									{
										apiVersion: `${GROUP}/${VERSION}`,
										kind: KIND,
										name: owner.name,
										uid: owner.uid,
									},
								],
							}
						: {}),
				},
				type: "Opaque",
				data,
			};
			try {
				await core.createNamespacedSecret({ namespace, body });
			} catch (ex) {
				if (!isStatus(ex, 409)) throw ex;
				await core.replaceNamespacedSecret({ namespace, name, body });
			}
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
	private readonly starting = new Map<string, Promise<ServerHandle>>();
	private readonly store: ServerStore;
	private readonly fallback: McpHost;
	private readonly clock: () => number;
	private readonly pollMs: number;
	private readonly startTimeoutMs: number;

	constructor(private readonly options: KubernetesHostOptions) {
		this.store = options.store ?? clientStore(options.namespace);
		this.fallback = options.fallback ?? new LocalProcessHost();
		this.clock = options.clock ?? epochSeconds;
		this.pollMs = options.pollMs ?? POLL_MS;
		this.startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
	}

	async ensure(conf: ConnConfig): Promise<ServerHandle | undefined> {
		if (launchFor(conf) === undefined) return await this.fallback.ensure(conf);
		const pending = this.starting.get(conf.name);
		if (pending) return await pending;
		const run = this.serving(conf).finally(() =>
			this.starting.delete(conf.name),
		);
		this.starting.set(conf.name, run);
		return await run;
	}

	async stop(name: string): Promise<void> {
		await this.starting.get(name)?.catch(() => {});
		const followed = this.followed.get(name);
		if (!followed) return await this.fallback.stop(name);
		this.unfollow(followed);
		await this.store.patchSpec(followed.name, { lastUsed: 0 });
	}

	async stopAll(): Promise<void> {
		await Promise.allSettled(this.starting.values());
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

	async asleep(name: string): Promise<boolean> {
		const followed = this.followed.get(name);
		if (!followed) return await this.fallback.asleep(name);
		if (followed.state !== "running") return false;
		const live = await this.store.get(followed.name);
		const slept =
			live === undefined ||
			live.status?.phase === "Sleeping" ||
			this.clock() - live.spec.lastUsed >= live.spec.idleSeconds;
		if (slept) this.unfollow(followed);
		return slept;
	}

	private unfollow(followed: Followed): void {
		followed.state = "stopped";
	}

	private async serving(conf: ConnConfig): Promise<ServerHandle> {
		const launch = launchFor(conf);
		if (!launch) throw new Error(`${conf.name}: has no container to run.`);
		const { scope } = this.options;
		const name = serverName(scope, conf.name);
		const secret = envSecretName(name);
		const data = encoded(conf.env);
		const wanted = specFor(conf, launch, scope, this.clock(), {
			secret,
			hash: envHash(conf.env),
		});

		const live = await this.store.get(name);
		let server: McpServer;
		if (live) {
			await this.store.putEnv(secret, data, ownerOf(live));
			server = await this.store.patchSpec(
				name,
				respecced(live.spec, wanted, live.status?.phase === "Failed"),
			);
		} else {
			await this.store.putEnv(secret, data);
			server = await this.store.create({
				apiVersion: `${GROUP}/${VERSION}`,
				kind: KIND,
				metadata: { name },
				spec: wanted,
			});
			const owner = ownerOf(server);
			if (owner) await this.store.putEnv(secret, data, owner);
		}

		const followed: Followed = this.followed.get(conf.name) ?? {
			name,
			state: "running",
			logs: "",
			touched: 0,
		};
		this.followed.set(conf.name, followed);
		const url = await this.answering(conf.name, server, followed);
		this.follow(followed);
		const headers = "headers" in conf ? conf.headers : undefined;
		return headers ? { url, headers } : { url };
	}

	private async answering(
		label: string,
		asked: McpServer,
		followed: Followed,
	): Promise<string> {
		const generation = asked.metadata.generation ?? 0;
		const deadline = Date.now() + this.startTimeoutMs;
		let last: McpServer | undefined = asked;
		while (Date.now() < deadline) {
			last = await this.store.get(asked.metadata.name);
			const status = last?.status;
			const current = (status?.observedGeneration ?? 0) >= generation;
			if (current && status?.phase === "Ready" && status.endpoints?.mcp)
				return status.endpoints.mcp;
			if (current && status?.phase === "Failed") {
				followed.state = "stopped";
				followed.logs = status.logTail ?? "";
				throw new Error(
					`${label}: ${status.reason ?? "its server failed"} before it answered.${tail(followed.logs)}`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, this.pollMs));
		}
		followed.state = "stopped";
		throw new Error(
			`${label}: asked the cluster for it but it did not answer within ${this.startTimeoutMs / 1000}s (last phase: ${last?.status?.phase ?? "none"}).`,
		);
	}

	private follow(followed: Followed): void {
		followed.state = "running";
		followed.touched = this.clock();
	}
}

function ownerOf(server: McpServer): Owner | undefined {
	return server.metadata.uid
		? { name: server.metadata.name, uid: server.metadata.uid }
		: undefined;
}

function tail(logs: string): string {
	const last = logs.trim().split("\n").slice(-6).join("\n");
	return last ? `\n${last}` : "";
}
