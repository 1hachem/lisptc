import {
	ApiException,
	CoreV1Api,
	CustomObjectsApi,
	type KubeConfig,
	NetworkingV1Api,
	PatchStrategy,
	setHeaderOptions,
	type V1Namespace,
	type V1NetworkPolicy,
	type V1PersistentVolumeClaim,
	type V1Pod,
	type V1Secret,
	type V1Service,
} from "@kubernetes/client-node";
import {
	GROUP,
	type McpServer,
	type McpServerStatus,
	PLURAL,
	VERSION,
} from "@repo/mcp-extension/kubernetes";
import { MANAGED_BY, MANAGER } from "./workload.ts";

const LOG_LINES = 20;
const REACH_TIMEOUT_MS = 2_000;
const MANAGED = `${MANAGED_BY}=${MANAGER}`;

export interface Located {
	namespace: string;
	name: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
}

export interface Cluster {
	ensureNamespace(namespace: V1Namespace): Promise<void>;
	ensureNetworkPolicy(
		namespace: string,
		policy: V1NetworkPolicy,
	): Promise<void>;
	copySecret(from: string, to: string, name: string): Promise<void>;
	pod(namespace: string, name: string): Promise<V1Pod | undefined>;
	createPod(namespace: string, pod: V1Pod): Promise<void>;
	ensureService(namespace: string, service: V1Service): Promise<void>;
	removePod(namespace: string, name: string): Promise<void>;
	remove(namespace: string, name: string): Promise<void>;
	claims(
		namespace: string,
		selector: string,
	): Promise<V1PersistentVolumeClaim[]>;
	createClaim(namespace: string, claim: V1PersistentVolumeClaim): Promise<void>;
	annotateClaim(
		namespace: string,
		name: string,
		annotations: Record<string, string | null>,
	): Promise<void>;
	resizeClaim(namespace: string, name: string, size: string): Promise<void>;
	deleteClaim(namespace: string, name: string): Promise<void>;
	logs(namespace: string, pod: string, container: string): Promise<string>;
	reachable(url: string): Promise<boolean>;
	origin(namespace: string, service: string, port: number): string;
	managedPods(): Promise<Located[]>;
	managedClaims(): Promise<Located[]>;
	managedNamespaces(): Promise<Located[]>;
	annotateNamespace(
		name: string,
		annotations: Record<string, string | null>,
	): Promise<void>;
	deleteNamespace(name: string): Promise<void>;
}

export interface Servers {
	writeStatus(server: McpServer, status: McpServerStatus): Promise<void>;
	setFinalizers(server: McpServer, finalizers: string[]): Promise<void>;
	remove(name: string): Promise<void>;
}

function isStatus(ex: unknown, code: number): boolean {
	return ex instanceof ApiException && ex.code === code;
}

async function tolerating(code: number, run: () => Promise<unknown>) {
	try {
		await run();
	} catch (ex) {
		if (!isStatus(ex, code)) throw ex;
	}
}

const merge = setHeaderOptions("Content-Type", PatchStrategy.MergePatch);

function located(item: {
	metadata?: {
		namespace?: string;
		name?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
}): Located {
	return {
		namespace: item.metadata?.namespace ?? "",
		name: item.metadata?.name ?? "",
		labels: item.metadata?.labels ?? {},
		annotations: item.metadata?.annotations ?? {},
	};
}

export function clientCluster(config: KubeConfig): Cluster {
	const core = config.makeApiClient(CoreV1Api);
	const net = config.makeApiClient(NetworkingV1Api);
	const putSecret = async (namespace: string, body: V1Secret) => {
		try {
			await core.createNamespacedSecret({ namespace, body });
		} catch (ex) {
			if (!isStatus(ex, 409)) throw ex;
			await core.replaceNamespacedSecret({
				namespace,
				name: body.metadata?.name ?? "",
				body,
			});
		}
	};
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
			const source = await core.readNamespacedSecret({ namespace: from, name });
			await putSecret(to, {
				metadata: { name, labels: { [MANAGED_BY]: MANAGER } },
				type: source.type,
				data: source.data,
			});
		},
		async pod(namespace, name) {
			try {
				return await core.readNamespacedPod({ namespace, name });
			} catch (ex) {
				if (isStatus(ex, 404)) return undefined;
				throw ex;
			}
		},
		async createPod(namespace, body) {
			await core.createNamespacedPod({ namespace, body });
		},
		async ensureService(namespace, body) {
			await tolerating(409, () =>
				core.createNamespacedService({ namespace, body }),
			);
		},
		async removePod(namespace, name) {
			await tolerating(404, () =>
				core.deleteNamespacedPod({ namespace, name, gracePeriodSeconds: 0 }),
			);
		},
		async remove(namespace, name) {
			await Promise.all([
				tolerating(404, () =>
					core.deleteNamespacedService({ namespace, name }),
				),
				this.removePod(namespace, name),
			]);
		},
		async claims(namespace, labelSelector) {
			try {
				const list = await core.listNamespacedPersistentVolumeClaim({
					namespace,
					labelSelector,
				});
				return list.items;
			} catch (ex) {
				if (isStatus(ex, 404)) return [];
				throw ex;
			}
		},
		async createClaim(namespace, body) {
			await core.createNamespacedPersistentVolumeClaim({ namespace, body });
		},
		async annotateClaim(namespace, name, annotations) {
			await core.patchNamespacedPersistentVolumeClaim(
				{ namespace, name, body: { metadata: { annotations } } },
				merge,
			);
		},
		async resizeClaim(namespace, name, storage) {
			await core.patchNamespacedPersistentVolumeClaim(
				{
					namespace,
					name,
					body: { spec: { resources: { requests: { storage } } } },
				},
				merge,
			);
		},
		async deleteClaim(namespace, name) {
			await tolerating(404, () =>
				core.deleteNamespacedPersistentVolumeClaim({ namespace, name }),
			);
		},
		async logs(namespace, name, container) {
			try {
				return await core.readNamespacedPodLog({
					namespace,
					name,
					container,
					tailLines: LOG_LINES,
				});
			} catch {
				return "";
			}
		},
		async reachable(url) {
			try {
				await fetch(url, {
					method: "HEAD",
					signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
				});
				return true;
			} catch {
				return false;
			}
		},
		origin(namespace, service, port) {
			return `http://${service}.${namespace}.svc.cluster.local:${port}`;
		},
		async managedPods() {
			const list = await core.listPodForAllNamespaces({
				labelSelector: MANAGED,
			});
			return list.items.map(located);
		},
		async managedClaims() {
			const list = await core.listPersistentVolumeClaimForAllNamespaces({
				labelSelector: MANAGED,
			});
			return list.items.map(located);
		},
		async managedNamespaces() {
			const list = await core.listNamespace({ labelSelector: MANAGED });
			return list.items.map(located);
		},
		async annotateNamespace(name, annotations) {
			await core.patchNamespace(
				{ name, body: { metadata: { annotations } } },
				merge,
			);
		},
		async deleteNamespace(name) {
			await tolerating(404, () => core.deleteNamespace({ name }));
		},
	};
}

export function clientServers(config: KubeConfig, namespace: string): Servers {
	const custom = config.makeApiClient(CustomObjectsApi);
	const target = { group: GROUP, version: VERSION, namespace, plural: PLURAL };
	return {
		async writeStatus(server, status) {
			await custom.patchNamespacedCustomObjectStatus(
				{ ...target, name: server.metadata.name, body: { status } },
				merge,
			);
		},
		async setFinalizers(server, finalizers) {
			await custom.patchNamespacedCustomObject(
				{
					...target,
					name: server.metadata.name,
					body: { metadata: { finalizers } },
				},
				merge,
			);
		},
		async remove(name) {
			await tolerating(404, () =>
				custom.deleteNamespacedCustomObject({ ...target, name }),
			);
		},
	};
}
