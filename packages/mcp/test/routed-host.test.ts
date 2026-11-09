import { describe, expect, it } from "vitest";
import type { ConnConfig } from "../src/ports.ts";
import { RoutedHost } from "../src/routed-host.ts";
import { recordingHost } from "./helpers.ts";

const remote: ConnConfig = {
	name: "linear",
	url: "https://mcp.linear.app/mcp",
};
const container: ConnConfig = { name: "fs", image: "fs-mcp", port: 8000 };

function routed() {
	const remotes = recordingHost();
	const containers = recordingHost();
	const host = new RoutedHost([
		{ claims: (conf) => "url" in conf, host: remotes },
		{ claims: (conf) => "image" in conf, host: containers },
	]);
	return { host, remotes, containers };
}

describe("a routed host", () => {
	it("runs each server on the first host that claims it", async () => {
		const { host, remotes, containers } = routed();

		await host.ensure(remote);
		await host.remove(container);

		expect(remotes.ensured.map((conf) => conf.name)).toEqual(["linear"]);
		expect(containers.removed).toEqual(["fs"]);
	});

	it("stops a server on the host that runs it, and nowhere else", async () => {
		const { host, remotes, containers } = routed();
		await host.ensure(remote);

		await host.stop("linear");
		await host.stop("never-loaded");

		expect(remotes.stopped).toEqual(["linear"]);
		expect(containers.stopped).toEqual([]);
	});

	it("asks the host that runs a server about it", async () => {
		const { host, remotes } = routed();
		remotes.sleeping.add("linear");
		await host.ensure(remote);

		host.used("linear");

		expect(remotes.uses).toEqual(["linear"]);
		expect(await host.asleep("linear")).toBe(true);
		expect(host.status("other")).toBe("unknown");
	});

	it("takes every host down with it", async () => {
		const { host, remotes, containers } = routed();

		await host.stopAll();

		expect([remotes.stoppedAll, containers.stoppedAll]).toEqual([1, 1]);
	});

	it("refuses a server no host claims", async () => {
		const { host } = routed();

		await expect(
			host.ensure({ name: "cli", command: "cli-mcp" }),
		).rejects.toThrow(/no host here can run it/);
	});
});
