import { describe, expect, it } from "vitest";
import {
	envSecretName,
	KubernetesHost,
	type Owner,
	type ServerStore,
} from "../src/kubernetes-host.ts";
import {
	type McpServer,
	type McpServerStatus,
	serverName,
} from "../src/mcp-server-resource.ts";
import type { ContainerConnConfig, StdioConnConfig } from "../src/ports.ts";
import { recordingHost } from "./helpers.ts";

const browser: ContainerConnConfig = {
	name: "playwright",
	image: "playwright-mcp",
	port: 8931,
	env: { TOKEN: "s3cret" },
	headers: { authorization: "Bearer x" },
	app: { image: "chromium-vnc", state: "/data/profile" },
};

const remote = {
	name: "remote",
	url: "https://example.com/mcp",
} as const;

const NAME = serverName("ws1", "playwright");
const READY_URL = `http://${NAME}.lisptc-ws-ws1:8931/mcp`;

type Operator = (server: McpServer) => McpServerStatus | undefined;

const ready: Operator = (server) => ({
	phase: "Ready",
	endpoints: { mcp: READY_URL },
	observedGeneration: server.metadata.generation,
});

function fakeStore(operator: Operator = ready) {
	const servers = new Map<string, McpServer>();
	const env = new Map<
		string,
		{ data: Record<string, string>; owner?: Owner }
	>();
	const patches: Partial<McpServer["spec"]>[] = [];
	let uid = 0;
	const store: ServerStore = {
		async get(name) {
			const server = servers.get(name);
			if (!server) return undefined;
			const status = operator(server);
			if (status) server.status = status;
			return structuredClone(server);
		},
		async create(server) {
			uid += 1;
			const created = structuredClone(server);
			created.metadata.uid = `uid-${uid}`;
			created.metadata.generation = 1;
			servers.set(server.metadata.name, created);
			return structuredClone(created);
		},
		async patchSpec(name, spec) {
			const server = servers.get(name);
			if (!server) throw new Error(`no ${name}`);
			patches.push(spec);
			server.spec = { ...server.spec, ...spec };
			server.metadata.generation = (server.metadata.generation ?? 0) + 1;
			return structuredClone(server);
		},
		async putEnv(name, data, owner) {
			env.set(name, { data, ...(owner ? { owner } : {}) });
		},
	};
	return { store, servers, env, patches };
}

function host(
	store: ServerStore,
	fallback = recordingHost(),
	clock = () => 1000,
) {
	return new KubernetesHost({
		scope: "ws1",
		namespace: "lisptc",
		store,
		fallback,
		pollMs: 1,
		startTimeoutMs: 200,
		clock,
	});
}

function ticking() {
	let now = 1000;
	return {
		clock: () => now,
		pass(seconds: number) {
			now += seconds;
		},
	};
}

describe("the kubernetes host", () => {
	it("asks for a server and hands back the address the operator reports", async () => {
		const fake = fakeStore();

		const handle = await host(fake.store).ensure(browser);

		expect(handle).toEqual({
			url: READY_URL,
			headers: { authorization: "Bearer x" },
		});
		const server = fake.servers.get(NAME);
		expect(server?.spec.app?.state).toMatchObject([
			{ name: "profile", path: "/data/profile" },
		]);
		expect(server?.spec.lastUsed).toBe(1000);
	});

	it("keeps the env in a secret the server owns, never in its spec", async () => {
		const fake = fakeStore();

		await host(fake.store).ensure(browser);

		const secret = fake.env.get(envSecretName(NAME));
		expect(secret?.data).toEqual({ TOKEN: btoa("s3cret") });
		expect(secret?.owner).toEqual({ name: NAME, uid: "uid-1" });
		expect(JSON.stringify(fake.servers.get(NAME)?.spec)).not.toContain(
			"s3cret",
		);
	});

	it("reuses a server another process asked for", async () => {
		const fake = fakeStore();
		await host(fake.store).ensure(browser);

		await host(fake.store).ensure(browser);

		expect(fake.servers.size).toBe(1);
		expect(fake.patches).toHaveLength(1);
	});

	it("keeps a resize and a reset made on the live server", async () => {
		const fake = fakeStore();
		await host(fake.store).ensure(browser);
		const live = fake.servers.get(NAME);
		const state = live?.spec.app?.state[0];
		if (!state) throw new Error("no state");
		state.size = "5Gi";
		state.reset = 2;

		await host(fake.store).ensure(browser);

		expect(fake.servers.get(NAME)?.spec.app?.state[0]).toMatchObject({
			size: "5Gi",
			reset: 2,
		});
	});

	it("raises restarts on a failed server, and never deletes it", async () => {
		let failNext = 0;
		const fake = fakeStore((server) => {
			if (failNext === 0) return ready(server);
			failNext -= 1;
			return {
				phase: "Failed",
				reason: "app: CrashLoopBackOff",
				observedGeneration: server.metadata.generation,
			};
		});
		await host(fake.store).ensure(browser);
		const before = fake.servers.get(NAME);
		failNext = 1;

		await host(fake.store).ensure(browser);

		expect(fake.servers.get(NAME)).toBe(before);
		expect(fake.servers.get(NAME)?.spec.restarts).toBe(1);
	});

	it("names why the server failed and keeps its last lines", async () => {
		const fake = fakeStore((server) => ({
			phase: "Failed",
			reason: "mcp exited with code 1",
			logTail: "booting\nchromium crashed",
			observedGeneration: server.metadata.generation,
		}));
		const kube = host(fake.store);

		await expect(kube.ensure(browser)).rejects.toThrow(
			/mcp exited with code 1[\s\S]*chromium crashed/,
		);
		expect(kube.status("playwright")).toBe("stopped");
		expect(kube.logs("playwright")).toContain("chromium crashed");
	});

	it("ignores a status the operator wrote for an older spec", async () => {
		let calls = 0;
		const fake = fakeStore((server) => {
			calls += 1;
			return calls < 3
				? { phase: "Failed", reason: "old", observedGeneration: 0 }
				: ready(server);
		});

		await expect(host(fake.store).ensure(browser)).resolves.toMatchObject({
			url: READY_URL,
		});
	});

	it("gives up when the server never answers", async () => {
		const fake = fakeStore(() => ({ phase: "Starting" }));

		await expect(host(fake.store).ensure(browser)).rejects.toThrow(
			/did not answer within 0.2s \(last phase: Starting\)/,
		);
	});

	it("puts a server to sleep when it is stopped", async () => {
		const fake = fakeStore();
		const kube = host(fake.store);
		await kube.ensure(browser);

		await kube.stop("playwright");

		expect(fake.servers.get(NAME)?.spec.lastUsed).toBe(0);
		expect(kube.status("playwright")).toBe("stopped");
	});

	it("puts every server it runs to sleep when it stops them all", async () => {
		const fake = fakeStore();
		const fallback = recordingHost();
		const kube = host(fake.store, fallback);
		await kube.ensure(browser);

		await kube.stopAll();

		expect(fake.servers.get(NAME)?.spec.lastUsed).toBe(0);
		expect(kube.status("playwright")).toBe("stopped");
		expect(fallback.stoppedAll).toBe(1);
	});

	it("hands a remote server and a stdio one to the right place", async () => {
		const fake = fakeStore();
		const fallback = recordingHost();
		const kube = host(fake.store, fallback);
		const stdio: StdioConnConfig = { name: "fs", command: "npx", args: ["x"] };

		await kube.ensure(remote);
		await kube.ensure(stdio);

		expect(fallback.ensured.map((conf) => conf.name)).toEqual(["remote"]);
		expect(fake.servers.has(serverName("ws1", "fs"))).toBe(true);
	});

	it("keeps a server awake only while its tools are called", async () => {
		const fake = fakeStore();
		const time = ticking();
		const kube = host(fake.store, recordingHost(), time.clock);
		await kube.ensure(browser);

		kube.used("playwright");
		time.pass(30);
		kube.used("playwright");
		time.pass(60);
		kube.used("playwright");

		expect(fake.patches.map((patch) => patch.lastUsed)).toEqual([1090]);
		expect(fake.servers.get(NAME)?.spec.lastUsed).toBe(1090);
	});

	it("tells a server went to sleep once the operator slept it", async () => {
		let phase: "Ready" | "Sleeping" = "Ready";
		const fake = fakeStore((server) => ({
			...ready(server),
			phase,
		}));
		const kube = host(fake.store);
		await kube.ensure(browser);
		expect(await kube.phase("playwright")).toEqual({ phase: "ready" });

		phase = "Sleeping";

		expect(await kube.phase("playwright")).toEqual({ phase: "sleeping" });
		expect(kube.status("playwright")).toBe("stopped");
	});

	it("tells a server failed, with the reason the operator gave", async () => {
		let phase: "Ready" | "Failed" = "Ready";
		const fake = fakeStore((server) => ({
			...ready(server),
			phase,
			...(phase === "Failed" ? { reason: "ImagePullBackOff" } : {}),
		}));
		const kube = host(fake.store);
		await kube.ensure(browser);

		phase = "Failed";

		expect(await kube.phase("playwright")).toEqual({
			phase: "failed",
			reason: "ImagePullBackOff",
		});
		expect(kube.status("playwright")).toBe("stopped");
	});

	it("tells a server went to sleep once its idle window has passed", async () => {
		const fake = fakeStore();
		const time = ticking();
		const kube = host(fake.store, recordingHost(), time.clock);
		await kube.ensure(browser);
		const idle = fake.servers.get(NAME)?.spec.idleSeconds ?? 0;

		time.pass(idle - 1);
		expect(await kube.phase("playwright")).toEqual({ phase: "ready" });
		time.pass(1);
		expect(await kube.phase("playwright")).toEqual({ phase: "sleeping" });
	});

	it("lets go of a server someone deleted from the cluster", async () => {
		const fake = fakeStore();
		const kube = host(fake.store);
		await kube.ensure(browser);

		fake.servers.delete(NAME);

		expect(await kube.phase("playwright")).toEqual({ phase: "gone" });
		expect(kube.status("playwright")).toBe("stopped");
	});

	it("asks the fallback about a server it does not run", async () => {
		const fallback = recordingHost();
		fallback.phases.set("remote", { phase: "sleeping" });
		const kube = host(fakeStore().store, fallback);

		kube.used("remote");

		expect(fallback.uses).toEqual(["remote"]);
		expect(await kube.phase("remote")).toEqual({ phase: "sleeping" });
	});
});
