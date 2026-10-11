import { describe, expect, it } from "vitest";
import { volumeName } from "../src/docker-host.ts";
import { LocalProcessHost } from "../src/local-host.ts";

describe("a pair on a host without containers", () => {
	it("is refused, naming the host it needs", async () => {
		await expect(
			new LocalProcessHost().ensure({
				name: "playwright",
				image: "playwright-mcp",
				port: 8931,
				app: { image: "chromium-vnc", state: "/data/profile" },
			}),
		).rejects.toThrow(/needs a container host/);
	});

	it("is refused when only the mcp keeps state", async () => {
		await expect(
			new LocalProcessHost().ensure({
				name: "notes",
				image: "notes-mcp",
				port: 8000,
				state: "/data",
			}),
		).rejects.toThrow(/needs a container host/);
	});
});

describe("state on docker", () => {
	it("names a volume after the workspace, the server and the state", () => {
		expect(volumeName("ws1", "Playwright", "profile")).toBe(
			"lisptc-ws1-playwright-profile",
		);
	});

	it("keeps two workspaces' state apart", () => {
		expect(volumeName("ws1", "playwright", "profile")).not.toBe(
			volumeName("ws2", "playwright", "profile"),
		);
	});
});
