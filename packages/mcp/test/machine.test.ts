import { driveAsync, settled } from "@repo/interpreter/drive";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { ConnConfig, UserMachine } from "../src/ports.ts";
import { desktopToolkit } from "../src/toolkit.ts";

const CLUSTER: ConnConfig = { name: "remote", url: "https://example.com/mcp" };
const LOCAL: ConnConfig = {
	name: "local-git",
	description: "git on the machine",
	command: "uvx",
	args: ["mcp-server-git"],
	local: true,
};

function session(online: { value: boolean }) {
	const connected = () => online.value;
	const machine: UserMachine = { connected, servers: () => ["local-git"] };
	const extension = mcpExtension({
		...mcpHost,
		toolkit: desktopToolkit({ all: () => [CLUSTER] }, [LOCAL], connected),
		machine,
	});
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = openSession([extension]);
	const step = async (): Promise<string> => {
		let emitted = "";
		await driveAsync(
			hooks.beginStep.run(() => settled(undefined), {
				interp,
				emit: (text) => {
					emitted += text;
				},
			}),
		);
		return emitted;
	};
	const listed = () => str(runSync(interp, "(list-toolkit)"));
	return { step, listed };
}

describe("the user's machine", () => {
	it("lists local servers only while the desktop is connected, marked :local", () => {
		const online = { value: false };
		const { listed } = session(online);
		expect(listed()).not.toMatch(/local-git/);
		online.value = true;
		expect(listed()).toMatch(
			/"local-git" "git on the machine" nil :unloaded :local\)/,
		);
		expect(listed()).toMatch(/"remote" "" nil :unloaded\)/);
	});

	it("tells the session when the desktop connects and disconnects", async () => {
		const online = { value: true };
		const { step } = session(online);
		expect(await step()).toBe(
			"desktop app connected: local servers now loadable: local-git",
		);
		expect(await step()).toBe("");
		online.value = false;
		expect(await step()).toBe(
			"desktop app disconnected: local servers gone: local-git",
		);
		expect(await step()).toBe("");
	});

	it("says nothing at the start when no desktop is connected", async () => {
		expect(await session({ value: false }).step()).toBe("");
	});
});
