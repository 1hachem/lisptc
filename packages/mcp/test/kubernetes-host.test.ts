import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Cluster,
	DEFAULT_RESOURCES,
	dnsLabel,
	KubernetesHost,
	namespaceFor,
	type PodState,
	SHM_LIMIT,
	type Workload,
	workloadFor,
} from "../src/kubernetes-host.ts";
import type { ContainerConnConfig, StdioConnConfig } from "../src/ports.ts";
import { recordingHost } from "./helpers.ts";

const playwright: ContainerConnConfig = {
	name: "playwright",
	image: "ghcr.io/1hachem/lisptc-browser-mcp:main",
	port: 8931,
	env: { TOKEN: "s3cret" },
	headers: { authorization: "Bearer x" },
};

const filesystem: StdioConnConfig = {
	name: "fs",
	command: "npx",
	args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
};

let answering: Server;
let origin: string;

beforeAll(async () => {
	answering = createServer((_req, res) => res.end());
	await new Promise<void>((resolve) => answering.listen(0, resolve));
	origin = `http://127.0.0.1:${(answering.address() as AddressInfo).port}`;
});

afterAll(() => {
	answering.close();
});

function fakeCluster(
	states: PodState[] = [{ phase: "ready" }],
	{ failCreate = false } = {},
) {
	const created: { namespace: string; workload: Workload }[] = [];
	const removed: string[] = [];
	const labelled: string[] = [];
	const namespaces: string[] = [];
	const policies: string[] = [];
	const copied: string[] = [];
	const touched: string[] = [];
	let next = 0;
	const cluster: Cluster = {
		async ensureNamespace(ns) {
			namespaces.push(ns.metadata?.name ?? "");
		},
		async ensureNetworkPolicy(namespace) {
			policies.push(namespace);
		},
		async copySecret(from, to, name) {
			copied.push(`${from}/${name} -> ${to}`);
		},
		async create(namespace, workload) {
			if (failCreate) throw new Error("pods is forbidden");
			created.push({ namespace, workload });
		},
		async state() {
			const state = states[Math.min(next, states.length - 1)];
			next += 1;
			return state ?? { phase: "gone" };
		},
		async logs() {
			return "chromium crashed";
		},
		async remove(_namespace, name) {
			removed.push(name);
		},
		async removeLabelled(_namespace, selector) {
			labelled.push(selector);
		},
		async touchNamespace(namespace, seen) {
			touched.push(`${namespace}@${seen}`);
		},
		async touchPod(namespace, pod, seen) {
			touched.push(`${namespace}/${pod}@${seen}`);
		},
		origin: () => origin,
	};
	return {
		cluster,
		created,
		removed,
		labelled,
		namespaces,
		policies,
		copied,
		touched,
	};
}

describe("naming in the cluster", () => {
	it("names the namespace after the workspace", () => {
		expect(namespaceFor("lisptc-ws-", "jd7ABc123")).toBe("lisptc-ws-jd7abc123");
	});

	it("keeps a name within a dns label", () => {
		const name = namespaceFor("lisptc-ws-", "x".repeat(80));
		expect(name).toHaveLength(63);
		expect(dnsLabel("My Server!!")).toBe("my-server");
	});
});

describe("the workload a server runs as", () => {
	it("keeps the env out of the pod spec and dials it through a service", () => {
		const labels = { "lisptc.io/mcp-server": "playwright" };
		const { secret, pod, service } = workloadFor(
			"mcp-playwright",
			playwright,
			{ image: playwright.image, exposed: "8931", path: "/mcp", args: [] },
			labels,
			1_700_000_000,
		);

		expect(secret.stringData).toEqual({ TOKEN: "s3cret" });
		const container = pod.spec?.containers[0];
		expect(container?.env).toBeUndefined();
		expect(container?.envFrom).toEqual([
			{ secretRef: { name: "mcp-playwright" } },
		]);
		expect(container?.args).toBeUndefined();
		expect(pod.spec?.automountServiceAccountToken).toBe(false);
		expect(service.spec?.selector).toEqual(labels);
		expect(service.spec?.ports).toEqual([{ port: 8931, targetPort: 8931 }]);
		expect(pod.metadata?.annotations).toEqual({
			"lisptc.io/last-seen": "1700000000",
		});
	});

	it("bounds a server by default and lets its entry ask for more", () => {
		const launch = { image: "x", exposed: "8931", path: "/mcp", args: [] };
		const bounded = workloadFor("mcp-a", playwright, launch, {}, 0).pod.spec
			?.containers[0]?.resources;
		expect(bounded).toEqual(DEFAULT_RESOURCES);

		const asked = workloadFor(
			"mcp-b",
			{ ...playwright, resources: { limits: { memory: "4Gi" } } },
			launch,
			{},
			0,
		).pod.spec?.containers[0]?.resources;
		expect(asked?.limits).toEqual({ cpu: "2", memory: "4Gi" });
		expect(asked?.requests).toEqual(DEFAULT_RESOURCES.requests);
	});

	it("leaves room above the memory-backed shm, which counts against the limit", () => {
		const gib = (quantity: string) => Number.parseInt(quantity, 10);
		expect(gib(DEFAULT_RESOURCES.limits.memory)).toBeGreaterThan(
			gib(SHM_LIMIT),
		);
	});
});

describe("the kubernetes host", () => {
	it("runs a server in its workspace namespace and hands back its address", async () => {
		const fake = fakeCluster([{ phase: "starting" }, { phase: "ready" }]);
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			callerNamespace: "lisptc",
			cluster: fake.cluster,
		});

		const handle = await host.ensure(playwright);

		expect(handle).toEqual({
			url: `${origin}/mcp`,
			headers: { authorization: "Bearer x" },
		});
		expect(fake.namespaces).toEqual(["lisptc-ws-ws1"]);
		expect(fake.policies).toEqual(["lisptc-ws-ws1"]);
		expect(fake.created.map((c) => c.namespace)).toEqual(["lisptc-ws-ws1"]);
		expect(fake.touched).toEqual([
			expect.stringMatching(/^lisptc-ws-ws1@\d+$/),
		]);
		expect(host.status("playwright")).toBe("running");
		await host.stopAll();
	});

	it("pulls with a copy of the caller's pull secret", async () => {
		const fake = fakeCluster();
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			callerNamespace: "lisptc",
			pullSecret: "ghcr-pull",
			cluster: fake.cluster,
		});

		await host.ensure(playwright);

		expect(fake.copied).toEqual(["lisptc/ghcr-pull -> lisptc-ws-ws1"]);
		expect(fake.created[0]?.workload.pod.spec?.imagePullSecrets).toEqual([
			{ name: "ghcr-pull" },
		]);
		await host.stopAll();
	});

	it("pulls without a secret when it has no caller to copy one from", async () => {
		const fake = fakeCluster();
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			pullSecret: "ghcr-pull",
			cluster: fake.cluster,
		});

		await host.ensure(playwright);

		expect(fake.copied).toEqual([]);
		expect(
			fake.created[0]?.workload.pod.spec?.imagePullSecrets,
		).toBeUndefined();
		await host.stopAll();
	});

	it("wraps a stdio server in the gateway image", async () => {
		const fake = fakeCluster();
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			cluster: fake.cluster,
		});

		await host.ensure(filesystem);

		const pod = fake.created[0]?.workload.pod;
		expect(pod?.spec?.containers[0]?.image).toMatch(
			/^supercorp\/supergateway:/,
		);
		expect(fake.policies).toEqual([]);
		await host.stopAll();
	});

	it("names why a pod failed and removes it", async () => {
		const fake = fakeCluster([
			{ phase: "failed", reason: "ImagePullBackOff: not found" },
		]);
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			cluster: fake.cluster,
		});

		await expect(host.ensure(playwright)).rejects.toThrow(
			/ImagePullBackOff: not found[\s\S]*chromium crashed/,
		);
		expect(host.status("playwright")).toBe("unknown");
		expect(fake.removed).toHaveLength(2);
	});

	it("removes what a failed create left behind", async () => {
		const fake = fakeCluster([{ phase: "ready" }], { failCreate: true });
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			cluster: fake.cluster,
		});

		await expect(host.ensure(playwright)).rejects.toThrow(/forbidden/);
		expect(host.status("playwright")).toBe("unknown");
		expect(fake.removed).toHaveLength(2);
	});

	it("starts a server once when it is asked for twice at the same time", async () => {
		const fake = fakeCluster();
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			cluster: fake.cluster,
		});

		const [first, second] = await Promise.all([
			host.ensure(playwright),
			host.ensure(playwright),
		]);

		expect(fake.created).toHaveLength(1);
		expect(second).toEqual(first);
		await host.stopAll();
	});

	it("stops a server that was still starting", async () => {
		const fake = fakeCluster([{ phase: "starting" }, { phase: "ready" }]);
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			cluster: fake.cluster,
		});

		const started = host.ensure(playwright);
		await host.stop("playwright");
		await started;

		expect(host.status("playwright")).toBe("unknown");
		expect(fake.removed).toEqual([
			fake.created[0]?.workload.pod.metadata?.name,
			fake.created[0]?.workload.pod.metadata?.name,
		]);
	});

	it("starts a server again once its pod is gone", async () => {
		const fake = fakeCluster([
			{ phase: "ready" },
			{ phase: "gone" },
			{ phase: "ready" },
		]);
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			cluster: fake.cluster,
		});

		await host.ensure(playwright);
		await host.ensure(playwright);

		expect(fake.created).toHaveLength(2);
		await host.stopAll();
	});

	it("reaps what its own instance started when it stops", async () => {
		const fake = fakeCluster();
		const fallback = recordingHost();
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			cluster: fake.cluster,
			fallback,
		});

		await host.ensure(playwright);
		await host.stopAll();

		expect(fake.labelled).toEqual([
			expect.stringMatching(/^lisptc\.io\/mcp-host=[0-9a-f-]{36}$/),
		]);
		expect(fallback.stoppedAll).toBe(1);
		expect(host.status("playwright")).toBe("unknown");
	});

	it("hands a server that already speaks http to the fallback", async () => {
		const fallback = recordingHost();
		const host = new KubernetesHost({
			scope: "ws1",
			namespacePrefix: "lisptc-ws-",
			cluster: fakeCluster().cluster,
			fallback,
		});

		const handle = await host.ensure({
			name: "linear",
			url: "https://mcp.linear.app/mcp",
		});

		expect(handle).toEqual({ url: "https://mcp.linear.app/mcp" });
		expect(fallback.ensured.map((c) => c.name)).toEqual(["linear"]);
	});
});
