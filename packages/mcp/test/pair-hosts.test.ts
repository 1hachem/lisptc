import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { volumeName } from "../src/docker-host.ts";
import { LocalProcessHost, localStateArgs } from "../src/local-host.ts";

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

	it("runs as a local process when only the mcp keeps state", async () => {
		await expect(
			new LocalProcessHost().ensure({
				name: "notes",
				image: "notes-mcp",
				port: 8000,
				command: "notes-mcp",
				state: "/data",
			}),
		).resolves.toBeUndefined();
	});
});

describe("state on a local process", () => {
	it("moves each state path in the args under the state home", () => {
		const home = mkdtempSync(join(tmpdir(), "lisptc-state-"));
		const args = localStateArgs(
			{
				name: "playwright",
				image: "browser-mcp",
				port: 8931,
				command: "npx",
				args: ["--user-data-dir", "/home/pwuser/profile", "--headless"],
				state: "/home/pwuser/profile",
			},
			home,
			"ws1",
		);
		const profile = join(home, "ws1", "playwright", "profile");
		expect(args).toEqual(["--user-data-dir", profile, "--headless"]);
		expect(statSync(profile).isDirectory()).toBe(true);
	});

	it("leaves the args of a server without state alone", () => {
		const args = localStateArgs(
			{ name: "fs", command: "npx", args: ["-y", "fs-mcp", "."] },
			"/nowhere",
		);
		expect(args).toEqual(["-y", "fs-mcp", "."]);
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
