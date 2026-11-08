import { describe, expect, it } from "vitest";
import { NAMESPACE_IDLE_SECONDS, sweep } from "../src/sweep.ts";
import {
	EMPTY_SINCE,
	MANAGED_BY,
	MANAGER,
	SERVER_LABEL,
} from "../src/workload.ts";
import { fakeCluster, NAMESPACE, PREFIX } from "./helpers.ts";

function run(
	fake: ReturnType<typeof fakeCluster>,
	now: number,
	live: string[] = [],
	liveNamespaces: string[] = [],
) {
	return {
		done: sweep({
			cluster: fake.cluster,
			prefix: PREFIX,
			live: new Set(live),
			liveNamespaces: new Set(liveNamespaces),
			now,
		}),
	};
}

function managedNamespace(fake: ReturnType<typeof fakeCluster>, name: string) {
	fake.namespaces.set(name, {
		metadata: { name, labels: { [MANAGED_BY]: MANAGER } },
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

		await run(fake, 1000, ["kept"]).done;

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

	it("keeps a namespace that holds a server", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, `${PREFIX}ws2`);

		await run(fake, 1000, [], [`${PREFIX}ws2`]).done;
		await run(fake, 1000 + NAMESPACE_IDLE_SECONDS * 2, [], [`${PREFIX}ws2`])
			.done;

		expect(fake.namespaces.has(`${PREFIX}ws2`)).toBe(true);
	});

	it("never touches a namespace outside its prefix", async () => {
		const fake = fakeCluster();
		managedNamespace(fake, "kube-system");

		await run(fake, 1000).done;
		await run(fake, 1000 + NAMESPACE_IDLE_SECONDS).done;

		expect(fake.namespaces.has("kube-system")).toBe(true);
	});
});
