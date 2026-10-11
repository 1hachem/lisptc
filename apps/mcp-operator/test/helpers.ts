import type {
	V1Namespace,
	V1PersistentVolumeClaim,
	V1Pod,
	V1Secret,
	V1Service,
} from "@kubernetes/client-node";
import { launchFor } from "@repo/mcp-extension/docker-host";
import {
	KIND,
	type McpServer,
	type McpServerStatus,
	serverName,
	specFor,
	VERSION,
} from "@repo/mcp-extension/kubernetes";
import type { ContainerConnConfig } from "@repo/mcp-extension/ports";
import type { Cluster, Located, Servers } from "../src/cluster.ts";
import type { Deps } from "../src/reconcile.ts";
import type {
	ServerRow,
	Snapshot,
	StateRow,
	StatusSink,
} from "../src/status-sink.ts";

export const RELEASE = "lisptc";
export const PREFIX = "lisptc-ws-";
const WORKSPACE = "ws1";
export const NAMESPACE = `${PREFIX}${WORKSPACE}`;

export const browser: ContainerConnConfig = {
	name: "playwright",
	image: "playwright-mcp",
	port: 8931,
	app: {
		image: "chromium-vnc",
		ports: [
			{ name: "cdp", port: 9222 },
			{ name: "view", port: 6080 },
		],
		expose: ["view"],
		state: "/data/profile",
	},
};

export function server(
	conf: ContainerConnConfig = browser,
	now = 1000,
): McpServer {
	const launch = launchFor(conf);
	if (!launch) throw new Error("no launch");
	return {
		apiVersion: `lisptc.io/${VERSION}`,
		kind: KIND,
		metadata: {
			name: serverName(WORKSPACE, conf.name),
			namespace: RELEASE,
			uid: "uid-1",
			generation: 1,
			finalizers: [],
		},
		spec: specFor(conf, launch, WORKSPACE, now, {
			secret: "mcp-env-playwright",
			hash: "h",
		}),
	};
}

const key = (namespace: string, name: string) => `${namespace}/${name}`;

export function fakeCluster() {
	const namespaces = new Map<string, V1Namespace>();
	const policies: string[] = [];
	const copied: string[] = [];
	const secrets = new Map<string, V1Secret>();
	const pods = new Map<string, V1Pod>();
	const services = new Map<string, V1Service>();
	const claims = new Map<string, V1PersistentVolumeClaim>();
	const removed: string[] = [];
	const resizeRefusal = { message: undefined as string | undefined };
	let answering = true;
	let logs = "";
	secrets.set(key(RELEASE, "mcp-env-playwright"), {
		metadata: { name: "mcp-env-playwright" },
		data: { TOKEN: "czNjcmV0" },
	});

	function locate<T extends { metadata?: V1Pod["metadata"] }>(
		map: Map<string, T>,
	): Located[] {
		return [...map.entries()].map(([k, item]) => ({
			namespace: k.split("/")[0] ?? "",
			name: item.metadata?.name ?? "",
			labels: item.metadata?.labels ?? {},
			annotations: item.metadata?.annotations ?? {},
		}));
	}

	const cluster: Cluster = {
		async ensureNamespace(ns) {
			const name = ns.metadata?.name ?? "";
			if (!namespaces.has(name)) namespaces.set(name, ns);
		},
		async ensureNetworkPolicy(namespace, policy) {
			const name = `${namespace}/${policy.metadata?.name}`;
			if (!policies.includes(name)) policies.push(name);
		},
		async copySecret(from, to, name) {
			copied.push(`${from}/${name} -> ${to}`);
		},
		async secretData(namespace, name) {
			return secrets.get(key(namespace, name))?.data;
		},
		async putSecret(namespace, secret) {
			secrets.set(key(namespace, secret.metadata?.name ?? ""), secret);
		},
		async pod(namespace, name) {
			return pods.get(key(namespace, name));
		},
		async createPod(namespace, pod) {
			pods.set(key(namespace, pod.metadata?.name ?? ""), pod);
		},
		async ensureService(namespace, service) {
			const k = key(namespace, service.metadata?.name ?? "");
			if (!services.has(k)) services.set(k, service);
		},
		async removePod(namespace, name) {
			if (pods.delete(key(namespace, name))) removed.push(`pod ${name}`);
		},
		async remove(namespace, name) {
			pods.delete(key(namespace, name));
			services.delete(key(namespace, name));
			secrets.delete(key(namespace, name));
			removed.push(`all ${name}`);
		},
		async claims(namespace, selector) {
			const wanted = Object.fromEntries(
				selector.split(",").map((pair) => pair.split("=")),
			);
			return [...claims.entries()]
				.filter(([k]) => k.startsWith(`${namespace}/`))
				.map(([, claim]) => claim)
				.filter((claim) =>
					Object.entries(wanted).every(
						([label, value]) => claim.metadata?.labels?.[label] === value,
					),
				);
		},
		async createClaim(namespace, claim) {
			const k = key(namespace, claim.metadata?.name ?? "");
			if (claims.has(k)) throw new Error(`claim ${k} already exists`);
			claims.set(k, claim);
		},
		async annotateClaim(namespace, name, annotations) {
			const claim = claims.get(key(namespace, name));
			if (!claim?.metadata) throw new Error(`no claim ${name}`);
			const next = { ...claim.metadata.annotations };
			for (const [k, value] of Object.entries(annotations))
				if (value === null) delete next[k];
				else next[k] = value;
			claim.metadata.annotations = next;
		},
		async resizeClaim(namespace, name, size) {
			if (resizeRefusal.message) throw new Error(resizeRefusal.message);
			const claim = claims.get(key(namespace, name));
			if (!claim?.spec) throw new Error(`no claim ${name}`);
			claim.spec.resources = { requests: { storage: size } };
		},
		async deleteClaim(namespace, name) {
			claims.delete(key(namespace, name));
			removed.push(`claim ${name}`);
		},
		async logs() {
			return logs;
		},
		async reachable() {
			return answering;
		},
		origin(namespace, service, port) {
			return `http://${service}.${namespace}:${port}`;
		},
		async managedPods() {
			return locate(pods);
		},
		async managedClaims() {
			return locate(claims);
		},
		async managedNamespaces() {
			return [...namespaces.values()].map((ns) => ({
				namespace: "",
				name: ns.metadata?.name ?? "",
				labels: ns.metadata?.labels ?? {},
				annotations: ns.metadata?.annotations ?? {},
			}));
		},
		async annotateNamespace(name, annotations) {
			const ns = namespaces.get(name);
			if (!ns) return;
			const next = { ...ns.metadata?.annotations };
			for (const [k, value] of Object.entries(annotations))
				if (value === null) delete next[k];
				else next[k] = value;
			ns.metadata = { ...ns.metadata, annotations: next };
		},
		async deleteNamespace(name) {
			namespaces.delete(name);
			removed.push(`namespace ${name}`);
		},
	};

	return {
		cluster,
		namespaces,
		policies,
		copied,
		secrets,
		pods,
		services,
		claims,
		removed,
		refuseResize(message: string) {
			resizeRefusal.message = message;
		},
		setAnswering(value: boolean) {
			answering = value;
		},
		setLogs(value: string) {
			logs = value;
		},
		bindAll() {
			for (const claim of claims.values())
				claim.status = {
					phase: "Bound",
					capacity: { storage: claim.spec?.resources?.requests?.storage ?? "" },
				};
		},
		runPods(ready = true) {
			for (const pod of pods.values())
				pod.status = {
					phase: "Running",
					containerStatuses: (pod.spec?.containers ?? []).map((c) => ({
						name: c.name,
						ready,
						restartCount: 0,
						image: c.image ?? "",
						imageID: "",
						state: { running: {} },
					})),
				};
		},
	};
}

function recordingServers(target: McpServer) {
	const writes: McpServerStatus[] = [];
	const removed: string[] = [];
	const servers: Servers = {
		async writeStatus(_, status) {
			writes.push(status);
			target.status = structuredClone(status);
		},
		async setFinalizers(_, finalizers) {
			target.metadata.finalizers = finalizers;
		},
		async remove(name) {
			removed.push(name);
		},
	};
	return { servers, writes, removed };
}

export function recordingSink() {
	const servers: ServerRow[] = [];
	const state: StateRow[] = [];
	const snapshots: Snapshot[] = [];
	const sink: StatusSink = {
		async observeServer(row) {
			servers.push(row);
		},
		async observeState(row) {
			state.push(row);
		},
		async reconcile(snapshot) {
			snapshots.push(snapshot);
		},
	};
	return { sink, servers, state, snapshots };
}

export function world(target: McpServer = server()) {
	const fake = fakeCluster();
	const recorded = recordingServers(target);
	const sink = recordingSink();
	const deps = (now: number): Deps => ({
		cluster: fake.cluster,
		servers: recorded.servers,
		sink: sink.sink,
		placement: { prefix: PREFIX, release: RELEASE, pullSecret: "ghcr-pull" },
		now,
	});
	return { target, fake, recorded, sink, deps };
}
