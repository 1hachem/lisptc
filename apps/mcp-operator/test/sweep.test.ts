import type { McpServer } from "@repo/mcp-extension/kubernetes";
import { describe, expect, it } from "vitest";
import { NAMESPACE_IDLE_SECONDS, sweep } from "../src/sweep.ts";
import {
	EMPTY_SINCE,
	MANAGED_BY,
	MANAGER,
	SERVER_LABEL,
	WORKSPACE_LABEL,
} from "../src/workload.ts";
import { fakeCluster, NAMESPACE, PREFIX, server } from "./helpers.ts";

function run(
	fake: ReturnType<typeof fakeCluster>,
	now: number,
	{
		servers = [],
		workspaces = ["ws1", "ws2"],
		chats = [],
		lookup,
	}: {
		servers?: McpServer[];
		workspaces?: string[];
		chats?: string[];
		lookup?: () => Promise<ReadonlySet<string>>;
	} = {},
) {
	const retired: string[] = [];
	const done = sweep({
		cluster: fake.cluster,
		prefix: PREFIX,
		servers,
		existing:
			lookup ??
			(async (ids) => new Set(ids.filter((id) => workspaces.includes(id)))),
		existingChats: async (ids) =>
			new Set(ids.filter((id) => chats.includes(id))),
		removeServer: async (name) => {
			retired.push(name);
		},
		now,
	});
	return { done, retired };
}

function managedNamespace(
	fake: ReturnType<typeof fakeCluster>,
	name: string,
	workspace?: string,
) {
	fake.namespaces.set(name, {
		metadata: {
			name,
			labels: {
				[MANAGED_BY]: MANAGER,
				...(workspace === undefined ? {} : { [WORKSPACE_LABEL]: workspace }),
			},
		},
	});
}

describe("the sweep", () => {
	it("removes a pod no server owns, such as one the old host left", async () => {
		const fake = fakeCluster();
		fake.pods.set(`${NAMESPACE}/mcp-playwright-1a2b3c4d`, {
			metadata: {
				name: "mcp-playwright-1a2b3c4d",
				labels: { [MANAGED_BY]: MANAGER, [SERVER_LABEL]: "playwright" },
			},
		});
		fake.pods.set(`${NAMESPACE}/kept`, {
			metadata: {
				name: "kept",
				labels: { [MANAGED_BY]: MANAGER, [SERVER_LABEL]: "kept" },
			},
		});

		const kept = server();
		kept.metadata.name = "kept";
		await run(fake, 1000, { servers: [kept] }).done;

		expect([...fake.pods.keys()]).toEqual([`${NAMESPACE}/kept`]);
	});

	it("leaves another release's pods alone", async () => {
		const fake = fakeCluster();
		fake.pods.set("lisptc-pr-7-ws-ws1/stranger", {
			metadata: { name: "stranger", labels: { [MANAGED_BY]: MANAGER } },
		});

		await run(fake, 1000).done;

		expect(fake.pods.size).toBe(1);
	});

	it("deletes an empty namespace only after it has stayed empty", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, NAMESPACE);

		await run(fake, 1000).done;
		expect(fake.namespaces.get(NAMESPACE)?.metadata?.annotations).toEqual({
			[EMPTY_SINCE]: "1000",
		});

		await run(fake, 1000 + NAMESPACE_IDLE_SECONDS - 1).done;
		expect(fake.namespaces.has(NAMESPACE)).toBe(true);

		await run(fake, 1000 + NAMESPACE_IDLE_SECONDS).done;
		expect(fake.namespaces.has(NAMESPACE)).toBe(false);
	});

	it("keeps a namespace while a server in it is awake", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, NAMESPACE, "ws1");
		const awake = server(undefined, 1000);
		const later = 1000 + awake.spec.idleSeconds - 1;

		await run(fake, later, { servers: [awake] }).done;
		await run(fake, later, { servers: [awake] }).done;

		expect(fake.namespaces.has(NAMESPACE)).toBe(true);
		expect(
			fake.namespaces.get(NAMESPACE)?.metadata?.annotations,
		).toBeUndefined();
	});

	it("deletes a namespace a day after every server in it went to sleep", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, NAMESPACE, "ws1");
		const asleep = server(undefined, 1000);
		const slept = 1000 + asleep.spec.idleSeconds;

		await run(fake, slept, { servers: [asleep] }).done;
		await run(fake, slept + NAMESPACE_IDLE_SECONDS - 1, { servers: [asleep] })
			.done;
		expect(fake.namespaces.has(NAMESPACE)).toBe(true);

		await run(fake, slept + NAMESPACE_IDLE_SECONDS, { servers: [asleep] }).done;
		expect(fake.namespaces.has(NAMESPACE)).toBe(false);
	});

	it("retires a deleted workspace's servers and its namespace at once", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, NAMESPACE, "ws1");
		const orphan = server(undefined, 1000);

		const { done, retired } = run(fake, 1000, {
			servers: [orphan],
			workspaces: [],
		});
		await done;

		expect(retired).toEqual([orphan.metadata.name]);
		expect(fake.namespaces.has(NAMESPACE)).toBe(false);
	});

	it("deletes the namespace of a deleted workspace that has no server left", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, `${PREFIX}gone`, "gone");

		await run(fake, 1000).done;

		expect(fake.namespaces.has(`${PREFIX}gone`)).toBe(false);
	});

	it("retires a chat's own server once the chat is deleted, keeping the rest", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, NAMESPACE, "ws1");
		const shared = server(undefined, 1000);
		const ownOf = (chat: string): McpServer => ({
			...shared,
			metadata: { ...shared.metadata, name: `own-${chat}` },
			spec: { ...shared.spec, instance: chat },
		});

		const { done, retired } = run(fake, 1000, {
			servers: [shared, ownOf("kept"), ownOf("deleted")],
			chats: ["kept"],
		});
		await done;

		expect(retired).toEqual(["own-deleted"]);
	});

	it("deletes nothing when it cannot tell which workspaces still exist", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, NAMESPACE, "ws1");
		const kept = server(undefined, 1000);

		const { done, retired } = run(fake, 1000 + NAMESPACE_IDLE_SECONDS * 2, {
			servers: [kept],
			lookup: () => Promise.reject(new Error("convex is down")),
		});
		await expect(done).rejects.toThrow("convex is down");

		expect(retired).toEqual([]);
		expect(fake.namespaces.has(NAMESPACE)).toBe(true);
	});

	it("never touches a namespace outside its prefix", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, "kube-system");

		await run(fake, 1000).done;
		await run(fake, 1000 + NAMESPACE_IDLE_SECONDS).done;

		expect(fake.namespaces.has("kube-system")).toBe(true);
	});
});
