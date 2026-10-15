import { describe, expect, it } from "vitest";
import { toolkitImages } from "../src/prepull.ts";
import { prepullFor, SPEC_HASH } from "../src/workload.ts";

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

	it("reads the bundled toolkit", () => {
		expect(toolkitImages("pr-7-abc").length).toBeGreaterThan(0);
	});

	it("pulls each image once in an init container that exits at once", () => {
		const set = prepullFor(["b:1", "a:1", "b:1"], "ghcr-pull");
		const pod = set.spec?.template.spec;

		expect(pod?.initContainers?.map((c) => [c.image, c.command])).toEqual([
			["a:1", ["true"]],
			["b:1", ["true"]],
		]);
		expect(pod?.imagePullSecrets).toEqual([{ name: "ghcr-pull" }]);
		expect(set.spec?.template.metadata?.labels).not.toHaveProperty(
			"app.kubernetes.io/managed-by",
		);
	});

	it("changes its hash only when the images change", () => {
		const hash = (images: string[]) =>
			prepullFor(images).metadata?.annotations?.[SPEC_HASH];

		expect(hash(["a:1", "b:1"])).toBe(hash(["b:1", "a:1"]));
		expect(hash(["a:1"])).not.toBe(hash(["a:2"]));
	});
});
