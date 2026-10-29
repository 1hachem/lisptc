import { claimName } from "@repo/mcp-extension/kubernetes";
import { describe, expect, it } from "vitest";
import { FINALIZER, reconcile } from "../src/reconcile.ts";
import {
	RECLAIM,
	RELEASED_AT,
	SHM_LIMIT,
	SPEC_HASH,
	STATE_GROUP,
} from "../src/workload.ts";
import { browser, NAMESPACE, RELEASE, server, world } from "./helpers.ts";

async function readyWorld() {
	const w = world();
	await reconcile(w.target, w.deps(1000));
	w.fake.bindAll();
	w.fake.runPods();
	await reconcile(w.target, w.deps(1001));
	return w;
}

function profileClaim(w: ReturnType<typeof world>) {
	const claim = w.fake.claims.get(
		`${NAMESPACE}/${claimName(w.target.metadata.name, "profile")}`,
	);
	if (!claim) throw new Error("no profile claim");
	return claim;
}

describe("a new server", () => {
	it("prepares its namespace and starts the pair on its own claim", async () => {
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
			{ name: "state-profile", mountPath: "/data/profile" },
		]);
		expect(pod?.spec?.volumes).toContainEqual({
			name: "shm",
			emptyDir: { medium: "Memory", sizeLimit: SHM_LIMIT },
		});
		expect(pod?.spec?.restartPolicy).toBe("Never");
		expect(pod?.spec?.securityContext?.fsGroup).toBe(STATE_GROUP);
		expect(pod?.spec?.imagePullSecrets).toEqual([{ name: "ghcr-pull" }]);

		const service = w.fake.services.get(
			`${NAMESPACE}/${w.target.metadata.name}`,
		);
		expect(service?.spec?.ports?.map((p) => p.name)).toEqual(["mcp", "view"]);

		expect(profileClaim(w).spec?.resources?.requests?.storage).toBe("1Gi");
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

	it("runs one container and no claim when it has no app", async () => {
		const w = world(server({ name: "fs", image: "fs-mcp", port: 8000 }));

		await reconcile(w.target, w.deps(1000));

		const pod = w.fake.pods.get(`${NAMESPACE}/${w.target.metadata.name}`);
		expect(pod?.spec?.containers.map((c) => c.name)).toEqual(["mcp"]);
		expect(w.fake.claims.size).toBe(0);
	});

	it("is Ready only once both containers are ready and the mcp answers", async () => {
		const w = world();
		await reconcile(w.target, w.deps(1000));
		w.fake.bindAll();
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
		expect(w.target.status?.state?.profile).toMatchObject({
			phase: "Bound",
			lastAttached: 1002,
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
		w.fake.bindAll();
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
		w.fake.bindAll();
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

	it("brings a failed pair back on the same claim when restarts is raised", async () => {
		const w = await readyWorld();
		const claim = profileClaim(w);

		w.target.spec.restarts = 1;
		await reconcile(w.target, w.deps(1100));
		await reconcile(w.target, w.deps(1101));

		expect(profileClaim(w)).toBe(claim);
		expect(w.fake.removed).toContain(`pod ${w.target.metadata.name}`);
		expect(w.fake.removed).not.toContain(
			`claim ${claimName(w.target.metadata.name, "profile")}`,
		);
	});
});

describe("the state a pair keeps", () => {
	it("sleeps when idle, keeping its claim, and wakes on it", async () => {
		const w = await readyWorld();
		const claim = profileClaim(w);

		await reconcile(w.target, w.deps(1600));

		expect(w.target.status?.phase).toBe("Sleeping");
		expect(w.fake.pods.size).toBe(0);
		expect(profileClaim(w)).toBe(claim);
		expect(w.target.status?.state?.profile?.lastAttached).toBe(1600);

		w.target.spec.lastUsed = 2000;
		await reconcile(w.target, w.deps(2000));
		expect(w.fake.pods.size).toBe(1);
		expect(profileClaim(w)).toBe(claim);
	});

	it("patches the claim when its size is raised", async () => {
		const w = await readyWorld();
		const state = w.target.spec.app?.state[0];
		if (!state) throw new Error("no state");
		state.size = "5Gi";

		await reconcile(w.target, w.deps(1100));

		expect(profileClaim(w).spec?.resources?.requests?.storage).toBe("5Gi");
		expect(w.target.status?.state?.profile?.phase).toBe("Resizing");
	});

	it("reports a resize the storage class refuses and leaves the data", async () => {
		const w = await readyWorld();
		const state = w.target.spec.app?.state[0];
		if (!state) throw new Error("no state");
		state.size = "5Gi";
		w.fake.refuseResize("only dynamically provisioned pvc can be resized");

		await reconcile(w.target, w.deps(1100));

		expect(w.target.status?.state?.profile?.reason).toMatch(
			/cannot resize to 5Gi/,
		);
		expect(profileClaim(w).spec?.resources?.requests?.storage).toBe("1Gi");
	});

	it("starts over on an empty claim when reset is raised", async () => {
		const w = await readyWorld();
		const before = profileClaim(w);
		const state = w.target.spec.app?.state[0];
		if (!state) throw new Error("no state");
		state.reset = 1;

		await reconcile(w.target, w.deps(1100));
		expect(w.fake.claims.size).toBe(0);
		expect(w.fake.pods.size).toBe(0);

		await reconcile(w.target, w.deps(1101));
		expect(profileClaim(w)).not.toBe(before);
		expect(w.target.status?.state?.profile?.observedReset).toBe(1);

		await reconcile(w.target, w.deps(1102));
		expect(w.fake.claims.size).toBe(1);
	});

	it("releases the claim of an entry dropped from the spec", async () => {
		const w = await readyWorld();
		const app = w.target.spec.app;
		if (!app) throw new Error("no app");
		app.state = [];

		await reconcile(w.target, w.deps(1100));

		expect(profileClaim(w).metadata?.annotations?.[RELEASED_AT]).toBe("1100");
		expect(w.sink.state.at(-1)).toMatchObject({
			name: "profile",
			phase: "released",
			releasedAt: 1100,
		});
	});

	it("keeps a Retain claim when the server is deleted, and reattaches it", async () => {
		const w = await readyWorld();
		const claim = profileClaim(w);
		w.target.metadata.deletionTimestamp = "2026-10-11T00:00:00Z";

		await reconcile(w.target, w.deps(1100));

		expect(w.target.metadata.finalizers).toEqual([]);
		expect(w.fake.pods.size).toBe(0);
		expect(claim.metadata?.annotations?.[RELEASED_AT]).toBe("1100");
		expect(w.sink.servers.at(-1)?.phase).toBe("gone");

		const again = world(server(browser, 1200));
		again.fake.claims.set(
			`${NAMESPACE}/${claim.metadata?.name}`,
			structuredClone(claim),
		);
		await reconcile(again.target, again.deps(1200));
		expect(profileClaim(again).metadata?.annotations?.[RELEASED_AT]).toBe(
			undefined,
		);
	});

	it("deletes a Delete claim with its server", async () => {
		const w = world(
			server({
				...browser,
				app: {
					image: "chromium-vnc",
					state: { path: "/data/profile", reclaim: "Delete" },
				},
			}),
		);
		await reconcile(w.target, w.deps(1000));
		expect(profileClaim(w).metadata?.annotations?.[RECLAIM]).toBe("Delete");
		w.target.metadata.deletionTimestamp = "2026-10-11T00:00:00Z";

		await reconcile(w.target, w.deps(1100));

		expect(w.fake.claims.size).toBe(0);
		expect(w.sink.state.at(-1)).toMatchObject({
			name: "profile",
			phase: "gone",
		});
	});
});

describe("the table it keeps in step", () => {
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
