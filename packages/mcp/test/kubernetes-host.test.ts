import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Cluster,
	dnsLabel,
	KubernetesHost,
	namespaceFor,
	type PodState,
	type Workload,
	workloadFor,
} from "../src/kubernetes-host.ts";
import type { ContainerConnConfig, StdioConnConfig } from "../src/ports.ts";
import { recordingHost } from "./helpers.ts";

const playwright: ContainerConnConfig = {
	name: "playwright",
	image: "lisptc/browser-mcp:v1.63.0",
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

function fakeCluster(states: PodState[] = [{ phase: "ready" }]) {
	const created: { namespace: string; workload: Workload }[] = [];
	const removed: string[] = [];
	const labelled: string[] = [];
	const namespaces: string[] = [];
	const policies: string[] = [];
	let next = 0;
	const cluster: Cluster = {
		async ensureNamespace(ns) {
			namespaces.push(ns.metadata?.name ?? "");
		},
		async ensureNetworkPolicy(namespace) {
			policies.push(namespace);
		},
		async create(namespace, workload) {
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
		origin: () => origin,
	};
	return { cluster, created, removed, labelled, namespaces, policies };
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
		expect(host.status("playwright")).toBe("running");
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
