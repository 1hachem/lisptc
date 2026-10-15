import { describe, expect, it } from "vitest";
import {
	ownRepositories,
	prepull,
	retryStalledPulls,
	toolkitImages,
} from "../src/prepull.ts";
import { prepullFor, SPEC_HASH } from "../src/workload.ts";
import { fakeCluster, RELEASE } from "./helpers.ts";

describe("fetching the toolkit's images ahead of a load", () => {
	it("names every image the toolkit runs, its own at the deployed tag", () => {
		const images = toolkitImages("pr-7-abc", [
			{
				name: "sheets",
				image: "ghcr.io/o/mcp-sheets:main",
				port: 1,
				internal: true,
			},
			{ name: "grafana", image: "grafana/mcp-grafana:latest", port: 2 },
			{
				name: "browser",
				image: "ghcr.io/o/mcp-browser:main",
				port: 3,
				internal: true,
				app: { image: "chromium-vnc" },
			},
			{ name: "remote", url: "https://example.com/mcp" },
		]);

		expect(images).toEqual([
			"ghcr.io/o/mcp-sheets:pr-7-abc",
			"grafana/mcp-grafana:latest",
			"ghcr.io/o/mcp-browser:pr-7-abc",
			"chromium-vnc",
		]);
	});

	it("names the repositories we build ourselves, and no third party's", () => {
		expect(
			ownRepositories([
				{
					name: "sheets",
					image: "ghcr.io/o/mcp-sheets:main",
					port: 1,
					internal: true,
				},
				{ name: "grafana", image: "grafana/mcp-grafana:latest", port: 2 },
				{ name: "remote", url: "https://example.com/mcp" },
			]),
		).toEqual(["ghcr.io/o/mcp-sheets"]);
	});

	it("reads the bundled toolkit", () => {
		expect(toolkitImages("pr-7-abc").length).toBeGreaterThan(0);
	});

	it("pulls each image in a daemon set of its own so the pulls run side by side", () => {
		const sets = prepullFor(
			["ghcr.io/o/b:1", "ghcr.io/o/a:1", "ghcr.io/o/b:1"],
			"ghcr-pull",
		);

		expect(
			sets.map((set) =>
				set.spec?.template.spec?.initContainers?.map((c) => [
					c.image,
					c.command,
				]),
			),
		).toEqual([[["ghcr.io/o/a:1", ["true"]]], [["ghcr.io/o/b:1", ["true"]]]]);
		expect(new Set(sets.map((set) => set.metadata?.name)).size).toBe(2);
		for (const set of sets) {
			expect(set.spec?.template.spec?.imagePullSecrets).toEqual([
				{ name: "ghcr-pull" },
			]);
			expect(set.spec?.selector.matchLabels).toEqual(
				set.spec?.template.metadata?.labels,
			);
			expect(set.spec?.template.metadata?.labels).not.toHaveProperty(
				"app.kubernetes.io/managed-by",
			);
		}
		expect(sets[0]?.spec?.selector.matchLabels).not.toEqual(
			sets[1]?.spec?.selector.matchLabels,
		);
	});

	it("keeps a set's name across tags and changes its hash", () => {
		const [before] = prepullFor(["ghcr.io/o/a:1"]);
		const [after] = prepullFor(["ghcr.io/o/a:2"]);

		expect(after?.metadata?.name).toBe(before?.metadata?.name);
		expect(after?.metadata?.annotations?.[SPEC_HASH]).not.toBe(
			before?.metadata?.annotations?.[SPEC_HASH],
		);
	});

	it("ensures every set even when one fails, and drops the ones no longer wanted", async () => {
		const fake = fakeCluster();
		const [old] = prepullFor(["ghcr.io/o/gone:1"]);
		if (old) await fake.cluster.ensureDaemonSet(RELEASE, old);
		const sets = prepullFor(["ghcr.io/o/a:1", "ghcr.io/o/b:1"]);
		const ensure = fake.cluster.ensureDaemonSet;
		fake.cluster.ensureDaemonSet = async (namespace, set) => {
			if (set.metadata?.name === sets[0]?.metadata?.name)
				throw new Error("refused");
			return ensure(namespace, set);
		};

		await expect(prepull(fake.cluster, RELEASE, sets)).rejects.toThrow(
			"refused",
		);

		expect([...fake.daemonSets.values()].map((s) => s.metadata?.name)).toEqual([
			sets[1]?.metadata?.name,
		]);
	});

	it("restarts only the pods whose pull failed, so kubelet's back-off starts over", async () => {
		const fake = fakeCluster();
		const labels = prepullFor(["ghcr.io/o/a:1"])[0]?.spec?.template.metadata
			?.labels;
		const pod = (name: string, reason?: string) =>
			fake.cluster.createPod(RELEASE, {
				metadata: { name, labels },
				status: {
					initContainerStatuses: [
						{
							name: "fetch",
							image: "ghcr.io/o/a:1",
							imageID: "",
							ready: false,
							restartCount: 0,
							state: reason ? { waiting: { reason } } : {},
						},
					],
				},
			});
		await pod("backing-off", "ImagePullBackOff");
		await pod("failed", "ErrImagePull");
		await pod("pulling");

		expect(await retryStalledPulls(fake.cluster, RELEASE)).toEqual([
			"backing-off",
			"failed",
		]);
		expect([...fake.pods.keys()]).toEqual([`${RELEASE}/pulling`]);
	});
});
