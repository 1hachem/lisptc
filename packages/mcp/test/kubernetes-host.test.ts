import { describe, expect, it } from "vitest";
import { KubernetesHost, type ServerStore } from "../src/kubernetes-host.ts";
import {
	type McpServer,
	type McpServerStatus,
	serverName,
} from "../src/mcp-server-resource.ts";
import type { ContainerConnConfig, StdioConnConfig } from "../src/ports.ts";
import { bundledToolkit } from "../src/toolkit.ts";

const browser: ContainerConnConfig = {
	name: "playwright",
	image: "playwright-mcp",
	port: 8931,
	headers: { authorization: "Bearer x" },
	app: { image: "chromium-vnc" },
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
	const patches: Partial<McpServer["spec"]>[] = [];
	const removed: string[] = [];
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
		async remove(name) {
			removed.push(name);
			servers.delete(name);
		},
	};
	return { store, servers, patches, removed };
}

function host(store: ServerStore, clock = () => 1000, imageTag?: string) {
	return new KubernetesHost({
		scope: "ws1",
		namespace: "lisptc",
		store,
		limits: { pollMs: 1, stallMs: 200, ceilingMs: 400 },
		clock,
		imageTag,
	});
}

function ownOf(chat: string) {
	return { ...browser, instance: chat };
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
		expect(server?.spec.app?.image).toBe("chromium-vnc");
		expect(server?.spec.lastUsed).toBe(1000);
	});

	it.each([
		["ghcr.io/o/mcp-browser:main", "ghcr.io/o/mcp-browser:pr-7-abc"],
		["ghcr.io/o/mcp-browser:latest", "ghcr.io/o/mcp-browser:pr-7-abc"],
		["registry:5000/mcp-browser:1.2", "registry:5000/mcp-browser:pr-7-abc"],
		["mcp-browser", "mcp-browser:pr-7-abc"],
		["mcp-browser@sha256:abc", "mcp-browser@sha256:abc"],
	])("runs internal image %s as %s when handed a tag", async (image, ran) => {
		const fake = fakeStore();

		await host(fake.store, () => 1000, "pr-7-abc").ensure({
			...browser,
			image,
			internal: true,
		});

		expect(fake.servers.get(NAME)?.spec.mcp?.image).toBe(ran);
	});

	it("runs an image the repo does not build at its own tag", async () => {
		const fake = fakeStore();

		await host(fake.store, () => 1000, "pr-7-abc").ensure({
			...browser,
			image: "grafana/mcp-grafana:latest",
		});

		expect(fake.servers.get(NAME)?.spec.mcp?.image).toBe(
			"grafana/mcp-grafana:latest",
		);
	});

	it("runs an internal image as written when handed no tag", async () => {
		const fake = fakeStore();

		await host(fake.store).ensure({
			...browser,
			image: "mcp-browser:latest",
			internal: true,
		});

		expect(fake.servers.get(NAME)?.spec.mcp?.image).toBe("mcp-browser:latest");
	});

	it("runs every internal image the toolkit names at the tag it was handed", async () => {
		const fake = fakeStore();
		const tagged = host(fake.store, () => 1000, "pr-7-abc");
		const images = bundledToolkit()
			.all()
			.filter((conf) => "internal" in conf && conf.internal);

		for (const conf of images) await tagged.ensure(conf);

		expect(images.length).toBeGreaterThan(0);
		for (const conf of images)
			expect(
				fake.servers.get(serverName("ws1", conf.name))?.spec.mcp?.image,
			).toMatch(/:pr-7-abc$/);
	});

	it("refuses a server that sets env, and asks the cluster for nothing", async () => {
		const fake = fakeStore();

		await expect(
			host(fake.store).ensure({ ...browser, env: { TOKEN: "s3cret" } }),
		).rejects.toThrow(
			"playwright: sets env, which a server on the cluster cannot take.",
		);
		expect(fake.servers.size).toBe(0);
	});

	it("reuses a server another process asked for", async () => {
		const fake = fakeStore();
		await host(fake.store).ensure(browser);

		await host(fake.store).ensure(browser);

		expect(fake.servers.size).toBe(1);
		expect(fake.patches).toHaveLength(1);
	});

	it("shares one server between every chat of the workspace", async () => {
		const fake = fakeStore();

		await host(fake.store).ensure(browser);
		await host(fake.store).ensure(browser);

		expect([...fake.servers.keys()]).toEqual([NAME]);
		expect(fake.servers.get(NAME)?.spec.instance).toBeUndefined();
	});

	it("deletes the server it was asked to remove", async () => {
		const fake = fakeStore();
		const kube = host(fake.store);
		await kube.ensure(browser);

		await kube.remove(browser);

		expect(fake.removed).toEqual([NAME]);
		expect(fake.servers.has(NAME)).toBe(false);
		expect(kube.status({ name: "playwright" })).toBe("unknown");
	});

	it("deletes a server it never started, by the name it would have", async () => {
		const fake = fakeStore();

		await host(fake.store).remove(browser);

		expect(fake.removed).toEqual([NAME]);
	});

	it("deletes only this chat's own instance of a dedicated server", async () => {
		const fake = fakeStore();
		await host(fake.store).ensure(ownOf("chat-a"));
		await host(fake.store).ensure(browser);

		await host(fake.store).remove(ownOf("chat-a"));

		expect(fake.removed).toEqual([serverName("ws1", "playwright", "chat-a")]);
		expect(fake.servers.has(NAME)).toBe(true);
	});

	it("runs a dedicated server once per chat, apart from the shared one", async () => {
		const fake = fakeStore();
		await host(fake.store).ensure(ownOf("chat-a"));
		await host(fake.store).ensure(ownOf("chat-a"));
		await host(fake.store).ensure(ownOf("chat-b"));
		await host(fake.store).ensure(browser);

		expect([...fake.servers.keys()].sort()).toEqual(
			[
				NAME,
				serverName("ws1", "playwright", "chat-a"),
				serverName("ws1", "playwright", "chat-b"),
			].sort(),
		);
		expect(
			fake.servers.get(serverName("ws1", "playwright", "chat-b"))?.spec,
		).toMatchObject({ server: "playwright", instance: "chat-b" });
	});

	it("raises restarts on a failed server instead of recreating it", async () => {
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
		expect(kube.status({ name: "playwright" })).toBe("stopped");
		expect(kube.logs({ name: "playwright" })).toContain("chromium crashed");
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

	it("gives up on a server whose start stops moving, naming where it stood", async () => {
		const fake = fakeStore((server) => ({
			phase: "Starting",
			reason: "creating mcp",
			observedGeneration: server.metadata.generation,
		}));

		await expect(host(fake.store).ensure(browser)).rejects.toThrow(
			/made no progress for 0s.*playwright is starting on the cluster: creating mcp/,
		);
	});

	it("keeps waiting while the start moves, and tells each step", async () => {
		let polls = 0;
		const fake = fakeStore((server) => {
			polls += 1;
			if (polls > 30) return ready(server);
			return {
				phase: "Starting",
				reason: `step ${Math.floor(polls / 10)}`,
				observedGeneration: server.metadata.generation,
			};
		});
		const notes: string[] = [];
		const kube = new KubernetesHost({
			scope: "ws1",
			namespace: "lisptc",
			store: fake.store,
			limits: { pollMs: 5, stallMs: 250, ceilingMs: 2_000 },
		});

		await expect(
			kube.ensure(browser, { progress: (note) => notes.push(note) }),
		).resolves.toMatchObject({ url: READY_URL });
		expect(notes).toEqual([
			"playwright is starting on the cluster: step 0",
			"playwright is starting on the cluster: step 1",
			"playwright is starting on the cluster: step 2",
			"playwright is starting on the cluster: step 3",
		]);
	});

	it("gives up once the ceiling passes, however the start moves", async () => {
		let polls = 0;
		const fake = fakeStore((server) => {
			polls += 1;
			return {
				phase: "Starting",
				reason: `step ${polls}`,
				observedGeneration: server.metadata.generation,
			};
		});

		await expect(host(fake.store).ensure(browser)).rejects.toThrow(
			/did not have it answering within 0s/,
		);
	});

	it("lets a second load join a start, and tells it where the start stands", async () => {
		let open = false;
		const fake = fakeStore((server) =>
			open
				? ready(server)
				: {
						phase: "Starting",
						reason: 'Pulling image "playwright-mcp"',
						observedGeneration: server.metadata.generation,
					},
		);
		const kube = new KubernetesHost({
			scope: "ws1",
			namespace: "lisptc",
			store: fake.store,
			limits: { pollMs: 1, stallMs: 5_000, ceilingMs: 5_000 },
		});
		const first = kube.ensure(browser);
		await new Promise((resolve) => setTimeout(resolve, 20));
		const notes: string[] = [];

		const second = kube.ensure(browser, {
			progress: (note) => notes.push(note),
		});
		open = true;

		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(fake.patches).toHaveLength(0);
		expect(notes[0]).toBe(
			'playwright is starting on the cluster: Pulling image "playwright-mcp"',
		);
	});

	it("stops polling only once every load waiting on a start was cancelled", async () => {
		let polls = 0;
		const fake = fakeStore((server) => {
			polls += 1;
			return {
				phase: "Starting",
				reason: "creating mcp",
				observedGeneration: server.metadata.generation,
			};
		});
		const kube = new KubernetesHost({
			scope: "ws1",
			namespace: "lisptc",
			store: fake.store,
			limits: { pollMs: 1, stallMs: 5_000, ceilingMs: 5_000 },
		});
		const one = new AbortController();
		const two = new AbortController();
		const first = kube.ensure(browser, { signal: one.signal });
		const second = kube.ensure(browser, { signal: two.signal });

		one.abort();
		await expect(first).rejects.toThrow();
		const before = polls;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(polls).toBeGreaterThan(before);

		two.abort();
		await expect(second).rejects.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 10));
		const stopped = polls;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(polls).toBe(stopped);
	});

	it("puts a server to sleep when it is stopped", async () => {
		const fake = fakeStore();
		const kube = host(fake.store);
		await kube.ensure(browser);

		await kube.stop({ name: "playwright" });

		expect(fake.servers.get(NAME)?.spec.lastUsed).toBe(0);
		expect(kube.status({ name: "playwright" })).toBe("stopped");
	});

	it("puts every server it runs to sleep when it stops them all", async () => {
		const fake = fakeStore();
		const kube = host(fake.store);
		await kube.ensure(browser);

		await kube.stopAll();

		expect(fake.servers.get(NAME)?.spec.lastUsed).toBe(0);
		expect(kube.status({ name: "playwright" })).toBe("stopped");
	});

	it("records a remote server on the cluster and hands back its url at once", async () => {
		const fake = fakeStore(() => undefined);
		const kube = host(fake.store);

		expect(await kube.ensure(remote)).toEqual({ url: remote.url });

		expect(fake.servers.get(serverName("ws1", "remote"))?.spec.remote).toEqual({
			url: remote.url,
		});
	});

	it("deletes a remote server it was asked to remove", async () => {
		const fake = fakeStore();
		const kube = host(fake.store);
		await kube.ensure(remote);

		await kube.remove(remote);

		expect(fake.servers.has(serverName("ws1", "remote"))).toBe(false);
	});

	it("runs a stdio server with a command as a container", async () => {
		const fake = fakeStore();
		const kube = host(fake.store);
		const stdio: StdioConnConfig = { name: "fs", command: "npx", args: ["x"] };

		await kube.ensure(stdio);

		expect(fake.servers.has(serverName("ws1", "fs"))).toBe(true);
	});

	it("keeps a server awake only while its tools are called", async () => {
		const fake = fakeStore();
		const time = ticking();
		const kube = host(fake.store, time.clock);
		await kube.ensure(browser);

		kube.used({ name: "playwright" });
		time.pass(30);
		kube.used({ name: "playwright" });
		time.pass(60);
		kube.used({ name: "playwright" });

		expect(fake.patches.map((patch) => patch.lastUsed)).toEqual([1090]);
		expect(fake.servers.get(NAME)?.spec.lastUsed).toBe(1090);
	});

	it("keeps a chat's own server awake apart from the shared one beside it", async () => {
		const fake = fakeStore();
		const time = ticking();
		const kube = host(fake.store, time.clock);
		await kube.ensure(browser);
		await kube.ensure(ownOf("chat-a"));

		time.pass(90);
		kube.used({ name: "playwright", instance: "chat-a" });

		expect(fake.servers.get(NAME)?.spec.lastUsed).toBe(1000);
		expect(
			fake.servers.get(serverName("ws1", "playwright", "chat-a"))?.spec
				.lastUsed,
		).toBe(1090);
	});

	it("tells a server went to sleep once the operator slept it", async () => {
		let phase: "Ready" | "Sleeping" = "Ready";
		const fake = fakeStore((server) => ({
			...ready(server),
			phase,
		}));
		const kube = host(fake.store);
		await kube.ensure(browser);
		expect(await kube.asleep({ name: "playwright" })).toBe(false);

		phase = "Sleeping";

		expect(await kube.asleep({ name: "playwright" })).toBe(true);
		expect(kube.status({ name: "playwright" })).toBe("stopped");
		expect(await kube.asleep({ name: "playwright" })).toBe(false);
	});

	it("tells a server went to sleep once its idle window has passed", async () => {
		const fake = fakeStore();
		const time = ticking();
		const kube = host(fake.store, time.clock);
		await kube.ensure(browser);
		const idle = fake.servers.get(NAME)?.spec.idleSeconds ?? 0;

		time.pass(idle - 1);
		expect(await kube.asleep({ name: "playwright" })).toBe(false);
		time.pass(1);
		expect(await kube.asleep({ name: "playwright" })).toBe(true);
	});

	it("lets go of a server someone deleted from the cluster", async () => {
		const fake = fakeStore();
		const kube = host(fake.store);
		await kube.ensure(browser);

		fake.servers.delete(NAME);

		expect(await kube.asleep({ name: "playwright" })).toBe(true);
		expect(kube.status({ name: "playwright" })).toBe("stopped");
	});

	it("knows nothing of a server it does not run", async () => {
		const kube = host(fakeStore().store);

		kube.used({ name: "remote" });

		expect(kube.status({ name: "remote" })).toBe("unknown");
		expect(await kube.asleep({ name: "remote" })).toBe(false);
	});
});
