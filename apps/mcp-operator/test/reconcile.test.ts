import { serverName } from "@repo/mcp-extension/kubernetes";
import { describe, expect, it } from "vitest";
import { FINALIZER, reconcile } from "../src/reconcile.ts";
import { SHM_LIMIT, SPEC_HASH } from "../src/workload.ts";
import { NAMESPACE, RELEASE, server, world } from "./helpers.ts";

async function readyWorld() {
	const w = world();
	await reconcile(w.target, w.deps(1000));
	w.fake.runPods();
	await reconcile(w.target, w.deps(1001));
	return w;
}

describe("a new server", () => {
	it("prepares its namespace and starts the pair", async () => {
		const w = world();

		const outcome = await reconcile(w.target, w.deps(1000));

		expect([...w.fake.namespaces.keys()]).toEqual([NAMESPACE]);
		expect(w.fake.policies).toEqual([
			`${NAMESPACE}/mcp-egress`,
			`${NAMESPACE}/mcp-ingress`,
		]);
		expect(w.fake.copied).toEqual([`${RELEASE}/ghcr-pull -> ${NAMESPACE}`]);
		expect(w.target.metadata.finalizers).toEqual([FINALIZER]);
		expect(w.target.status?.phase).toBe("Starting");
		expect(outcome.requeueAt).toBe(1002);

		const pod = w.fake.pods.get(`${NAMESPACE}/${w.target.metadata.name}`);
		const containers = pod?.spec?.containers ?? [];
		expect(containers.map((c) => c.name)).toEqual(["mcp", "app"]);
		expect(containers[0]?.volumeMounts).toEqual([
			{ name: "shm", mountPath: "/dev/shm" },
		]);
		expect(containers[1]?.volumeMounts).toEqual([
			{ name: "shm", mountPath: "/dev/shm" },
		]);
		expect(pod?.spec?.volumes).toEqual([
			{ name: "shm", emptyDir: { medium: "Memory", sizeLimit: SHM_LIMIT } },
		]);
		expect(pod?.spec?.restartPolicy).toBe("Never");
		expect(pod?.spec?.imagePullSecrets).toEqual([{ name: "ghcr-pull" }]);

		const service = w.fake.services.get(
			`${NAMESPACE}/${w.target.metadata.name}`,
		);
		expect(service?.spec?.ports?.map((p) => p.name)).toEqual(["mcp", "view"]);

		expect(containers.every((c) => c.envFrom === undefined)).toBe(true);
	});

	it("copies the secret its server names and hands it over as env", async () => {
		const w = world(
			server({
				name: "ocr",
				image: "ocr-mcp",
				port: 8000,
				secret: { name: "lisptc-mcp-ocr", keys: ["MISTRAL_API_KEY"] },
			}),
		);

		await reconcile(w.target, w.deps(1000));

		expect(w.fake.copied).toEqual([
			`${RELEASE}/ghcr-pull -> ${NAMESPACE}`,
			`${RELEASE}/lisptc-mcp-ocr -> ${NAMESPACE}`,
		]);
		const pod = w.fake.pods.get(`${NAMESPACE}/${w.target.metadata.name}`);
		expect(pod?.spec?.containers[0]?.envFrom).toEqual([
			{ secretRef: { name: "lisptc-mcp-ocr" } },
		]);
	});

	it("runs one container when it has no app", async () => {
		const w = world(server({ name: "fs", image: "fs-mcp", port: 8000 }));

		await reconcile(w.target, w.deps(1000));

		const pod = w.fake.pods.get(`${NAMESPACE}/${w.target.metadata.name}`);
		expect(pod?.spec?.containers.map((c) => c.name)).toEqual(["mcp"]);
	});

	it("is Ready only once both containers are ready and the mcp answers", async () => {
		const w = world();
		await reconcile(w.target, w.deps(1000));
		w.fake.runPods();
		w.fake.setAnswering(false);

		await reconcile(w.target, w.deps(1001));
		expect(w.target.status?.phase).toBe("Starting");

		w.fake.setAnswering(true);
		const outcome = await reconcile(w.target, w.deps(1002));

		expect(w.target.status?.phase).toBe("Ready");
		expect(w.target.status?.endpoints).toEqual({
			mcp: `http://${w.target.metadata.name}.${NAMESPACE}:8931/mcp`,
			view: `http://${w.target.metadata.name}.${NAMESPACE}:6080`,
		});
		expect(outcome.requeueAt).toBe(1600);
		expect(w.sink.servers).toMatchObject([
			{ phase: "starting", reason: "creating its pod" },
			{
				phase: "starting",
				reason: `waiting for it to answer at http://${w.target.metadata.name}.${NAMESPACE}:8931/mcp`,
			},
			{ phase: "ready" },
		]);
	});

	it("says it is fetching the image while its containers are being created", async () => {
		const w = world();
		await reconcile(w.target, w.deps(1000));
		for (const pod of w.fake.pods.values())
			pod.status = {
				phase: "Pending",
				containerStatuses: (pod.spec?.containers ?? []).map((c) => ({
					name: c.name,
					ready: false,
					restartCount: 0,
					image: c.image ?? "",
					imageID: "",
					state: { waiting: { reason: "ContainerCreating" } },
				})),
			};
		w.fake.setEvent('Pulling image "playwright-mcp"');

		await reconcile(w.target, w.deps(1001));

		expect(w.target.status).toMatchObject({
			phase: "Starting",
			reason: 'Pulling image "playwright-mcp"',
		});
		expect(w.sink.servers.at(-1)).toMatchObject({
			phase: "starting",
			reason: 'Pulling image "playwright-mcp"',
		});
	});

	it("says which node it waits for when the pod cannot be placed", async () => {
		const w = world();
		await reconcile(w.target, w.deps(1000));
		for (const pod of w.fake.pods.values())
			pod.status = {
				phase: "Pending",
				conditions: [
					{
						type: "PodScheduled",
						status: "False",
						reason: "Unschedulable",
						message: "0/1 nodes are available: insufficient memory.",
					},
				],
			};

		await reconcile(w.target, w.deps(1001));

		expect(w.target.status?.reason).toBe(
			"waiting for a node: 0/1 nodes are available: insufficient memory.",
		);
	});

	it("names the app container that failed and keeps its last lines", async () => {
		const w = world();
		await reconcile(w.target, w.deps(1000));
		const pod = w.fake.pods.get(`${NAMESPACE}/${w.target.metadata.name}`);
		if (!pod) throw new Error("no pod");
		pod.status = {
			phase: "Pending",
			containerStatuses: [
				{
					name: "app",
					ready: false,
					restartCount: 0,
					image: "chromium-vnc",
					imageID: "",
					state: { waiting: { reason: "ImagePullBackOff" } },
				},
			],
		};
		w.fake.setLogs("pulling\nno such image");

		await reconcile(w.target, w.deps(1001));

		expect(w.target.status).toMatchObject({
			phase: "Failed",
			reason: "app: ImagePullBackOff",
			logTail: "pulling\nno such image",
		});
	});
});

describe("rolling the pod", () => {
	it("recreates the pod when the workload changes, but not on a heartbeat", async () => {
		const w = await readyWorld();
		const name = `${NAMESPACE}/${w.target.metadata.name}`;
		const hash = w.fake.pods.get(name)?.metadata?.labels?.[SPEC_HASH];

		w.target.spec.lastUsed = 1100;
		await reconcile(w.target, w.deps(1100));
		expect(w.fake.pods.get(name)?.metadata?.labels?.[SPEC_HASH]).toBe(hash);

		w.target.spec.mcp = { ...w.target.spec.mcp, image: "playwright-mcp:next" };
		await reconcile(w.target, w.deps(1101));
		expect(w.fake.pods.has(name)).toBe(false);
		await reconcile(w.target, w.deps(1102));
		expect(w.fake.pods.get(name)?.metadata?.labels?.[SPEC_HASH]).not.toBe(hash);
	});

	it("moves a server of our own onto the deployed tag, and leaves a third party's alone", async () => {
		const w = await readyWorld();
		const name = `${NAMESPACE}/${w.target.metadata.name}`;
		const deployed = (now: number, repositories: string[]) => {
			const deps = w.deps(now);
			return {
				...deps,
				placement: {
					...deps.placement,
					rollout: { tag: "pr-7-b", repositories },
				},
			};
		};

		await reconcile(w.target, deployed(1100, ["someone/else"]));
		expect(w.fake.pods.get(name)?.spec?.containers[0]?.image).toBe(
			"playwright-mcp",
		);

		await reconcile(w.target, deployed(1101, ["playwright-mcp"]));
		expect(w.fake.pods.has(name)).toBe(false);
		await reconcile(w.target, deployed(1102, ["playwright-mcp"]));
		const containers = w.fake.pods.get(name)?.spec?.containers ?? [];
		expect(containers.map((c) => c.image)).toEqual([
			"playwright-mcp:pr-7-b",
			"chromium-vnc",
		]);
		expect(w.target.spec.mcp.image).toBe("playwright-mcp");

		w.fake.runPods();
		await reconcile(w.target, deployed(1103, ["playwright-mcp"]));
		expect(w.fake.pods.has(name)).toBe(true);
	});

	it("brings a failed pair back on a new pod when restarts is raised", async () => {
		const w = await readyWorld();

		w.target.spec.restarts = 1;
		await reconcile(w.target, w.deps(1100));
		await reconcile(w.target, w.deps(1101));

		expect(w.fake.removed).toContain(`pod ${w.target.metadata.name}`);
		expect(w.fake.pods.size).toBe(1);
	});
});

describe("sleeping and deleting", () => {
	it("sleeps when idle and wakes on a fresh pod", async () => {
		const w = await readyWorld();

		await reconcile(w.target, w.deps(1600));

		expect(w.target.status?.phase).toBe("Sleeping");
		expect(w.fake.pods.size).toBe(0);

		w.target.spec.lastUsed = 2000;
		await reconcile(w.target, w.deps(2000));
		expect(w.fake.pods.size).toBe(1);
	});

	it("takes its pod and service with it when the server is deleted", async () => {
		const w = await readyWorld();
		w.target.metadata.deletionTimestamp = "2026-10-11T00:00:00Z";

		await reconcile(w.target, w.deps(1100));

		expect(w.target.metadata.finalizers).toEqual([]);
		expect(w.fake.pods.size).toBe(0);
		expect(w.fake.services.size).toBe(0);
		expect(w.sink.servers.at(-1)?.phase).toBe("gone");
	});
});

describe("the table it keeps in step", () => {
	it("keeps a chat's own instance apart in every row", async () => {
		const own = server();
		own.metadata.name = serverName("ws1", own.spec.server, "chat-a");
		own.spec.instance = "chat-a";
		const w = world(own);

		await reconcile(w.target, w.deps(1000));
		w.fake.runPods();
		await reconcile(w.target, w.deps(1001));

		expect(w.sink.servers.map((row) => row.instance)).toEqual(
			w.sink.servers.map(() => "chat-a"),
		);
		expect(w.sink.servers.length).toBeGreaterThan(0);
	});

	it("sends a new reason even when the phase stays the same", async () => {
		const w = world();
		await reconcile(w.target, w.deps(1000));
		const pod = w.fake.pods.get(`${NAMESPACE}/${w.target.metadata.name}`);
		if (!pod) throw new Error("no pod");
		pod.status = {
			phase: "Pending",
			containerStatuses: [
				{
					name: "app",
					ready: false,
					restartCount: 0,
					image: "chromium-vnc",
					imageID: "",
					state: { waiting: { reason: "ImagePullBackOff" } },
				},
			],
		};
		await reconcile(w.target, w.deps(1001));
		w.target.status = { ...w.target.status, reason: "an older reason." };

		await reconcile(w.target, w.deps(1002));

		expect(
			w.sink.servers.slice(-2).map((row) => [row.phase, row.reason]),
		).toEqual([
			["failed", "app: ImagePullBackOff"],
			["failed", "app: ImagePullBackOff"],
		]);
	});

	it("leaves the status unwritten when the table refuses the row, so it is sent again", async () => {
		const w = world();
		const { observeServer } = w.sink.sink;
		w.sink.sink.observeServer = async () => {
			throw new Error("convex is down");
		};

		await expect(reconcile(w.target, w.deps(1000))).rejects.toThrow(
			"convex is down",
		);
		expect(w.target.status?.phase).toBeUndefined();

		w.sink.sink.observeServer = observeServer;
		await reconcile(w.target, w.deps(1001));

		expect(w.target.status?.phase).toBe("Starting");
		expect(w.sink.servers.map((row) => row.phase)).toEqual(["starting"]);
	});
});
