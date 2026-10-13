import { createServer } from "node:http";
import {
	CoreV1Api,
	CustomObjectsApi,
	KubeConfig,
	type KubernetesObject,
	ListWatch,
	type V1Pod,
	Watch,
} from "@kubernetes/client-node";
import { mcpOperatorEnv } from "@repo/env/mcp-operator";
import {
	GROUP,
	type McpServer,
	PLURAL,
	VERSION,
} from "@repo/mcp-extension/kubernetes";
import { clientCluster, clientServers } from "./cluster.ts";
import { Controller } from "./controller.ts";
import { convexSink } from "./convex-sink.ts";
import { MANAGED_BY, MANAGER, SERVER_LABEL } from "./workload.ts";

const SWEEP_MS = 60_000;
const RESTART_MS = 5_000;
const PROBE_PORT = 8080;

const env = mcpOperatorEnv;
const config = new KubeConfig();
config.loadFromDefault();
const core = config.makeApiClient(CoreV1Api);
const custom = config.makeApiClient(CustomObjectsApi);
const release = env.LISPTC_MCP_NAMESPACE;

const watch = new Watch(config);

const servers = new ListWatch<McpServer & KubernetesObject>(
	`/apis/${GROUP}/${VERSION}/namespaces/${release}/${PLURAL}`,
	watch,
	() =>
		custom.listNamespacedCustomObject({
			group: GROUP,
			version: VERSION,
			namespace: release,
			plural: PLURAL,
		}),
	false,
);

const pods = new ListWatch<V1Pod>(
	"/api/v1/pods",
	watch,
	() =>
		core.listPodForAllNamespaces({
			labelSelector: `${MANAGED_BY}=${MANAGER}`,
		}),
	false,
	`${MANAGED_BY}=${MANAGER}`,
);

const controller = new Controller({
	cluster: clientCluster(config),
	servers: clientServers(config, release),
	sink: convexSink(env.CONVEX_URL, env.CONVEX_ADMIN_KEY),
	placement: {
		prefix: env.LISPTC_MCP_NAMESPACE_PREFIX,
		release,
		...(env.LISPTC_MCP_PULL_SECRET
			? { pullSecret: env.LISPTC_MCP_PULL_SECRET }
			: {}),
		...(env.LISPTC_MCP_STORAGE_CLASS
			? { storageClass: env.LISPTC_MCP_STORAGE_CLASS }
			: {}),
	},
	lookup: (name) => servers.get(name, release),
	all: () => [...servers.list(release)],
});

function report(what: string) {
	return (ex: unknown) =>
		console.error(`${what}: ${ex instanceof Error ? ex.message : String(ex)}`);
}

function keepAlive<T extends KubernetesObject>(
	informer: ListWatch<T>,
	name: string,
) {
	informer.on("error", (ex) => {
		report(`${name} watch dropped`)(ex);
		setTimeout(() => {
			informer.start().catch(report(`${name} watch restart`));
		}, RESTART_MS);
	});
}

const enqueueServer = (server: McpServer) =>
	controller.enqueue(server.metadata.name);
servers.on("add", enqueueServer);
servers.on("update", enqueueServer);
servers.on("connect", () => {
	controller.resync().catch(report("resync"));
});
keepAlive(servers, "mcpservers");

const enqueuePod = (pod: V1Pod) => {
	const name = pod.metadata?.labels?.[SERVER_LABEL];
	if (name && servers.get(name, release)) controller.enqueue(name);
};
pods.on("add", enqueuePod);
pods.on("update", enqueuePod);
pods.on("delete", enqueuePod);
keepAlive(pods, "pods");

await servers.start();
await pods.start();
const probe = createServer((request, response) => {
	response.writeHead(request.url === "/ready" ? 200 : 404).end();
}).listen(PROBE_PORT);
setInterval(() => {
	controller.sweep().catch(report("sweep"));
	controller.mirror().catch(report("mirror"));
}, SWEEP_MS);

for (const signal of ["SIGTERM", "SIGINT"] as const)
	process.on(signal, async () => {
		controller.stop();
		probe.close();
		await Promise.allSettled([servers.stop(), pods.stop()]);
		process.exit(0);
	});
