import { randomUUID } from "node:crypto";
import {
	ApiException,
	CoreV1Api,
	KubeConfig,
	NetworkingV1Api,
	type V1Namespace,
	type V1NetworkPolicy,
	type V1Pod,
	type V1Secret,
	type V1Service,
	VersionApi,
} from "@kubernetes/client-node";
import { type Launch, launchFor } from "./docker-host.ts";
import { LocalProcessHost } from "./local-host.ts";
import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
} from "./ports.ts";

const START_TIMEOUT_MS = 180_000;
const POLL_MS = 500;
const REFRESH_MS = 5_000;
const LOG_LINES = 200;
const LOGS_KEEP = 8192;
const NAME_MAX = 63;
const PROBE_TIMEOUT_MS = 3_000;

const MANAGED_BY = "app.kubernetes.io/managed-by";
const WORKSPACE_LABEL = "lisptc.io/workspace";
const HOST_LABEL = "lisptc.io/mcp-host";
const SERVER_LABEL = "lisptc.io/mcp-server";
const MANAGER = "lisptc-mcp";
const CONTAINER = "mcp";
const INGRESS_POLICY = "mcp-ingress";

const FATAL_WAITING = new Set([
	"ErrImagePull",
	"ImagePullBackOff",
	"InvalidImageName",
	"CreateContainerConfigError",
	"CreateContainerError",
	"CrashLoopBackOff",
]);

export type PodState =
	| { phase: "starting" }
	| { phase: "ready" }
	| { phase: "failed"; reason: string }
	| { phase: "gone" };

export interface Workload {
	secret: V1Secret;
	pod: V1Pod;
	service: V1Service;
}

export interface Cluster {
	ensureNamespace(namespace: V1Namespace): Promise<void>;
	ensureNetworkPolicy(
		namespace: string,
		policy: V1NetworkPolicy,
	): Promise<void>;
	copySecret(from: string, to: string, name: string): Promise<void>;
	create(namespace: string, workload: Workload): Promise<void>;
	state(namespace: string, pod: string): Promise<PodState>;
	logs(namespace: string, pod: string): Promise<string>;
	remove(namespace: string, name: string): Promise<void>;
	removeLabelled(namespace: string, selector: string): Promise<void>;
	origin(namespace: string, service: string, port: number): string;
}

export interface KubernetesHostOptions {
	scope: string;
	namespacePrefix: string;
	callerNamespace?: string;
	pullSecret?: string;
	cluster?: Cluster;
	fallback?: McpHost;
}

interface Server {
	name: string;
	handle: ServerHandle;
	logs: string;
	state: ServerState;
	refresh?: ReturnType<typeof setInterval>;
}

export function dnsLabel(value: string, max = NAME_MAX): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.slice(0, max)
		.replace(/^-+|-+$/g, "");
}

export function namespaceFor(prefix: string, scope: string): string {
	const name = dnsLabel(`${prefix}${scope}`);
	if (!/^[a-z0-9]/.test(name))
		throw new Error(`no namespace can be named after the scope "${scope}".`);
	return name;
}

function isStatus(ex: unknown, code: number): boolean {
	return ex instanceof ApiException && ex.code === code;
}

async function tolerating<T>(code: number, run: () => Promise<T>) {
	try {
		await run();
	} catch (ex) {
		if (!isStatus(ex, code)) throw ex;
	}
}

async function reachable(url: string): Promise<boolean> {
	try {
		await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
		return true;
	} catch {
		return false;
	}
}

function stateOf(pod: V1Pod): PodState {
	const phase = pod.status?.phase;
	const container = pod.status?.containerStatuses?.[0];
	if (phase === "Failed" || phase === "Succeeded") {
		const exit = container?.state?.terminated;
		return {
			phase: "failed",
			reason: exit
				? `exited with code ${exit.exitCode}${exit.reason ? ` (${exit.reason})` : ""}`
				: `ended in phase ${phase}`,
		};
	}
	const waiting = container?.state?.waiting;
	if (waiting?.reason && FATAL_WAITING.has(waiting.reason))
		return {
			phase: "failed",
			reason: `${waiting.reason}${waiting.message ? `: ${waiting.message}` : ""}`,
		};
	if (phase === "Running" && container?.ready) return { phase: "ready" };
	return { phase: "starting" };
}

export function clientCluster(config: KubeConfig = defaultConfig()): Cluster {
	const core = config.makeApiClient(CoreV1Api);
	const net = config.makeApiClient(NetworkingV1Api);
	return {
		async ensureNamespace(body) {
			await tolerating(409, () => core.createNamespace({ body }));
		},
		async ensureNetworkPolicy(namespace, body) {
			await tolerating(409, () =>
				net.createNamespacedNetworkPolicy({ namespace, body }),
			);
		},
		async copySecret(from, to, name) {
			const source = await core.readNamespacedSecret({
				namespace: from,
				name,
			});
			const body: V1Secret = {
				metadata: { name, labels: { [MANAGED_BY]: MANAGER } },
				type: source.type,
				data: source.data,
			};
			try {
				await core.createNamespacedSecret({ namespace: to, body });
			} catch (ex) {
				if (!isStatus(ex, 409)) throw ex;
				await core.replaceNamespacedSecret({ namespace: to, name, body });
			}
		},
		async create(namespace, { secret, pod, service }) {
			await core.createNamespacedSecret({ namespace, body: secret });
			await core.createNamespacedPod({ namespace, body: pod });
			await core.createNamespacedService({ namespace, body: service });
		},
		async state(namespace, name) {
			try {
				return stateOf(await core.readNamespacedPod({ namespace, name }));
			} catch (ex) {
				if (isStatus(ex, 404)) return { phase: "gone" };
				throw ex;
			}
		},
		async logs(namespace, name) {
			try {
				return await core.readNamespacedPodLog({
					namespace,
					name,
					container: CONTAINER,
					tailLines: LOG_LINES,
				});
			} catch {
				return "";
			}
		},
		async remove(namespace, name) {
			await Promise.all([
				tolerating(404, () =>
					core.deleteNamespacedService({ namespace, name }),
				),
				tolerating(404, () =>
					core.deleteNamespacedPod({ namespace, name, gracePeriodSeconds: 0 }),
				),
				tolerating(404, () => core.deleteNamespacedSecret({ namespace, name })),
			]);
		},
		async removeLabelled(namespace, labelSelector) {
			await Promise.all([
				core.deleteCollectionNamespacedService({ namespace, labelSelector }),
				core.deleteCollectionNamespacedPod({
					namespace,
					labelSelector,
					gracePeriodSeconds: 0,
				}),
				core.deleteCollectionNamespacedSecret({ namespace, labelSelector }),
			]);
		},
		origin(namespace, service, port) {
			return `http://${service}.${namespace}.svc.cluster.local:${port}`;
		},
	};
}

export async function clusterAnswers(
	config: KubeConfig = defaultConfig(),
): Promise<boolean> {
	const version = config.makeApiClient(VersionApi).getCode();
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(reject, PROBE_TIMEOUT_MS).unref(),
	);
	try {
		await Promise.race([version, timeout]);
		return true;
	} catch {
		return false;
	}
}

function defaultConfig(): KubeConfig {
	const config = new KubeConfig();
	config.loadFromDefault();
	return config;
}

export function workloadFor(
	name: string,
	conf: ConnConfig,
	launch: Launch,
	labels: Record<string, string>,
	pullSecret?: string,
): Workload {
	const port = Number(launch.exposed);
	const metadata = { name, labels };
	return {
		secret: { metadata, type: "Opaque", stringData: conf.env ?? {} },
		pod: {
			metadata,
			spec: {
				restartPolicy: "Never",
				automountServiceAccountToken: false,
				enableServiceLinks: false,
				...(pullSecret ? { imagePullSecrets: [{ name: pullSecret }] } : {}),
				containers: [
					{
						name: CONTAINER,
						image: launch.image,
						...(launch.args.length > 0 ? { args: launch.args } : {}),
						ports: [{ containerPort: port }],
						envFrom: [{ secretRef: { name } }],
						readinessProbe: {
							tcpSocket: { port },
							periodSeconds: 2,
						},
						securityContext: {
							allowPrivilegeEscalation: false,
						},
						volumeMounts: [{ name: "shm", mountPath: "/dev/shm" }],
					},
				],
				volumes: [
					{ name: "shm", emptyDir: { medium: "Memory", sizeLimit: "1Gi" } },
				],
			},
		},
		service: {
			metadata,
			spec: {
				selector: labels,
				ports: [{ port, targetPort: port }],
			},
		},
	};
}

export class KubernetesHost implements McpHost {
	private readonly servers = new Map<string, Server>();
	private readonly instance = randomUUID();
	private readonly namespace: string;
	private readonly cluster: Cluster;
	private readonly fallback: McpHost;
	private namespaceReady: Promise<void> | undefined;

	constructor(private readonly options: KubernetesHostOptions) {
		this.namespace = namespaceFor(options.namespacePrefix, options.scope);
		this.cluster = options.cluster ?? clientCluster();
		this.fallback = options.fallback ?? new LocalProcessHost();
	}

	async ensure(conf: ConnConfig): Promise<ServerHandle | undefined> {
		const launch = launchFor(conf);
		if (launch === undefined) return await this.fallback.ensure(conf);
		const running = this.servers.get(conf.name);
		if (running && running.state === "running") {
			const state = await this.cluster.state(this.namespace, running.name);
			if (state.phase === "ready") return running.handle;
			await this.stop(conf.name);
		}
		return await this.start(conf, launch);
	}

	async stop(name: string): Promise<void> {
		const server = this.servers.get(name);
		if (!server) return await this.fallback.stop(name);
		this.servers.delete(name);
		clearInterval(server.refresh);
		server.state = "stopped";
		await this.cluster.remove(this.namespace, server.name);
	}

	async stopAll(): Promise<void> {
		for (const name of [...this.servers.keys()]) await this.stop(name);
		await this.fallback.stopAll();
		await this.cluster
			.removeLabelled(this.namespace, `${HOST_LABEL}=${this.instance}`)
			.catch(() => {});
	}

	status(name: string): ServerState {
		const server = this.servers.get(name);
		return server ? server.state : this.fallback.status(name);
	}

	logs(name: string): string {
		const server = this.servers.get(name);
		return server ? server.logs : this.fallback.logs(name);
	}

	private labels(conf: ConnConfig): Record<string, string> {
		return {
			[MANAGED_BY]: MANAGER,
			[HOST_LABEL]: this.instance,
			[SERVER_LABEL]: dnsLabel(conf.name),
		};
	}

	private callerPullSecret(): string | undefined {
		return this.options.callerNamespace ? this.options.pullSecret : undefined;
	}

	private async ensureNamespace(): Promise<void> {
		this.namespaceReady ??= this.prepareNamespace().catch((ex) => {
			this.namespaceReady = undefined;
			throw ex;
		});
		await this.namespaceReady;
	}

	private async prepareNamespace(): Promise<void> {
		await this.cluster.ensureNamespace({
			metadata: {
				name: this.namespace,
				labels: {
					[MANAGED_BY]: MANAGER,
					[WORKSPACE_LABEL]: dnsLabel(this.options.scope),
					"pod-security.kubernetes.io/enforce": "baseline",
				},
			},
		});
		const caller = this.options.callerNamespace;
		if (caller === undefined) return;
		const pullSecret = this.options.pullSecret;
		if (pullSecret)
			await this.cluster.copySecret(caller, this.namespace, pullSecret);
		await this.cluster.ensureNetworkPolicy(this.namespace, {
			metadata: { name: INGRESS_POLICY },
			spec: {
				podSelector: { matchLabels: { [MANAGED_BY]: MANAGER } },
				policyTypes: ["Ingress"],
				ingress: [
					{
						_from: [
							{
								namespaceSelector: {
									matchLabels: { "kubernetes.io/metadata.name": caller },
								},
							},
						],
					},
				],
			},
		});
	}

	private async start(conf: ConnConfig, launch: Launch): Promise<ServerHandle> {
		await this.ensureNamespace();
		const name = dnsLabel(
			`mcp-${dnsLabel(conf.name, 40)}-${this.instance.slice(0, 8)}`,
		);
		const port = Number(launch.exposed);
		const url = new URL(
			launch.path,
			this.cluster.origin(this.namespace, name, port),
		).toString();
		const headers = "headers" in conf ? conf.headers : undefined;
		const server: Server = {
			name,
			handle: headers ? { url, headers } : { url },
			logs: "",
			state: "running",
		};
		await this.cluster.remove(this.namespace, name);
		await this.cluster.create(
			this.namespace,
			workloadFor(
				name,
				conf,
				launch,
				this.labels(conf),
				this.callerPullSecret(),
			),
		);
		this.servers.set(conf.name, server);
		try {
			await this.answering(conf.name, server, new URL(url).origin);
		} catch (ex) {
			this.servers.delete(conf.name);
			await this.cluster.remove(this.namespace, name).catch(() => {});
			throw ex;
		}
		this.follow(server);
		return server.handle;
	}

	private async answering(
		label: string,
		server: Server,
		origin: string,
	): Promise<void> {
		const deadline = Date.now() + START_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const state = await this.cluster.state(this.namespace, server.name);
			if (state.phase === "failed" || state.phase === "gone") {
				server.logs = await this.cluster.logs(this.namespace, server.name);
				const why = state.phase === "failed" ? state.reason : "was deleted";
				throw new Error(
					`${label}: its pod in ${this.namespace} ${why} before ${origin} answered.${tail(server.logs)}`,
				);
			}
			if (state.phase === "ready" && (await reachable(origin))) return;
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
		server.logs = await this.cluster.logs(this.namespace, server.name);
		throw new Error(
			`${label}: started its pod in ${this.namespace} but ${origin} did not answer within ${START_TIMEOUT_MS / 1000}s.${tail(server.logs)}`,
		);
	}

	private follow(server: Server): void {
		server.refresh = setInterval(async () => {
			const [state, logs] = await Promise.all([
				this.cluster.state(this.namespace, server.name),
				this.cluster.logs(this.namespace, server.name),
			]).catch(() => [undefined, undefined] as const);
			if (logs) server.logs = logs.slice(-LOGS_KEEP);
			if (state && (state.phase === "failed" || state.phase === "gone")) {
				server.state = "stopped";
				clearInterval(server.refresh);
			}
		}, REFRESH_MS);
		server.refresh.unref();
	}
}

function tail(logs: string): string {
	const last = logs.trim().split("\n").slice(-6).join("\n");
	return last ? `\n${last}` : "";
}
