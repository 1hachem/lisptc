import { describe, expect, it } from "vitest";
import type { ContainerConnConfig } from "../src/ports.ts";
import { type HostCandidate, ProbedHost } from "../src/probed-host.ts";
import { recordingHost } from "./helpers.ts";

const browser: ContainerConnConfig = {
	name: "browser",
	image: "ghcr.io/1hachem/lisptc-browser-mcp:main",
	port: 8931,
};

function candidate(available: () => Promise<boolean>, required = false) {
	const host = recordingHost();
	let probed = 0;
	const entry: HostCandidate = {
		name: "the cluster",
		available: () => {
			probed += 1;
			return available();
		},
		create: () => host,
		required,
	};
	return {
		entry,
		host,
		get probed() {
			return probed;
		},
	};
}

describe("choosing where servers run", () => {
	it("runs on the first host that answers", async () => {
		const kubernetes = candidate(async () => true);
		const docker = candidate(async () => true);
		const host = new ProbedHost([kubernetes.entry, docker.entry], () =>
			recordingHost(),
		);
		await host.ensure(browser);
		expect(kubernetes.host.ensured).toEqual([browser]);
		expect(docker.probed).toBe(0);
	});

	it("falls back to the next host when one does not answer", async () => {
		const kubernetes = candidate(async () => false);
		const docker = candidate(async () => true);
		const host = new ProbedHost([kubernetes.entry, docker.entry], () =>
			recordingHost(),
		);
		await host.ensure(browser);
		expect(docker.host.ensured).toEqual([browser]);
	});

	it("treats a probe that throws as one that did not answer", async () => {
		const kubernetes = candidate(async () => {
			throw new Error("no cluster");
		});
		const docker = candidate(async () => true);
		const host = new ProbedHost([kubernetes.entry, docker.entry], () =>
			recordingHost(),
		);
		await host.ensure(browser);
		expect(docker.host.ensured).toEqual([browser]);
	});

	it("fails with the reason when a required host does not answer", async () => {
		const kubernetes = candidate(async () => {
			throw new Error("its CustomResourceDefinition is not installed.");
		}, true);
		const docker = candidate(async () => true);
		const process = recordingHost();
		const host = new ProbedHost(
			[kubernetes.entry, docker.entry],
			() => process,
		);
		await expect(host.ensure(browser)).rejects.toThrow(
			"MCP servers have to run on the cluster here, but its CustomResourceDefinition is not installed.",
		);
		expect(docker.probed).toBe(0);
		expect(process.ensured).toEqual([]);
	});

	it("fails when a required host answers no", async () => {
		const host = new ProbedHost(
			[candidate(async () => false, true).entry],
			() => recordingHost(),
		);
		await expect(host.ensure(browser)).rejects.toThrow(
			"MCP servers have to run on the cluster here, but it did not answer.",
		);
	});

	it("probes again once a required host has failed", async () => {
		let ready = false;
		const kubernetes = candidate(async () => {
			if (!ready) throw new Error("not yet");
			return true;
		}, true);
		const host = new ProbedHost([kubernetes.entry], () => recordingHost());
		await expect(host.ensure(browser)).rejects.toThrow("not yet");
		await host.stopAll();
		ready = true;
		await host.ensure(browser);
		expect(kubernetes.probed).toBe(2);
		expect(kubernetes.host.ensured).toEqual([browser]);
	});

	it("runs in process when no container host answers", async () => {
		const process = recordingHost();
		const host = new ProbedHost(
			[candidate(async () => false).entry, candidate(async () => false).entry],
			() => process,
		);
		await host.ensure(browser);
		expect(process.ensured).toEqual([browser]);
	});

	it("probes once and keeps the host it chose", async () => {
		const kubernetes = candidate(async () => true);
		const host = new ProbedHost([kubernetes.entry], () => recordingHost());
		await Promise.all([host.ensure(browser), host.ensure(browser)]);
		await host.stop("browser");
		await host.stopAll();
		expect(kubernetes.probed).toBe(1);
		expect(kubernetes.host.stopped).toEqual(["browser"]);
		expect(kubernetes.host.stoppedAll).toBe(1);
	});

	it("probes nothing until a server is wanted", async () => {
		const kubernetes = candidate(async () => true);
		const host = new ProbedHost([kubernetes.entry], () => recordingHost());
		await host.stopAll();
		expect(kubernetes.probed).toBe(0);
		expect(host.status("browser")).toBe("unknown");
		expect(host.logs("browser")).toBe("");
	});
});
