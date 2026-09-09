import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOST = fileURLToPath(
	new URL("./fixture-shutdown-host.ts", import.meta.url),
);

function runHost(
	mode: string,
): Promise<{ code: number | null; exited: boolean }> {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			["--no-warnings", "--experimental-transform-types", HOST, mode],
			{ stdio: "ignore" },
		);
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ code: null, exited: false });
		}, 20_000);
		child.on("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, exited: true });
		});
	});
}

describe("releasing MCP servers lets the host process exit", () => {
	it("exits after (mcp-shutdown)", async () => {
		expect(await runHost("shutdown")).toEqual({ code: 0, exited: true });
	}, 30_000);

	it("exits after interp.dispose()", async () => {
		expect(await runHost("dispose")).toEqual({ code: 0, exited: true });
	}, 30_000);
});
