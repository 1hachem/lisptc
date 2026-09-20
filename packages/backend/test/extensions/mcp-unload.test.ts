import { fileURLToPath } from "node:url";
import { Interp, prelude, runAsync, runSync } from "@repo/interpreter/lisp";
import { mcpExtension } from "@repo/mcp-extension";
import { localMcpClient, mcpHost } from "@repo/mcp-extension/mcp-host";
import { promisesExtension } from "@repo/promises-extension";
import { describe, expect, it, vi } from "vitest";
import { recordingHost } from "./mcp-helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./mcp-fixture-mcp-server.ts", import.meta.url),
);

async function loaded(host: ReturnType<typeof recordingHost>): Promise<Interp> {
	const interp = new Interp({
		extensions: [
			promisesExtension(),
			mcpExtension({ ...mcpHost, client: localMcpClient({ host }) }),
		],
	});
	runSync(interp, prelude);
	await runAsync(
		interp,
		`(await (load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}"))))`,
	);
	return interp;
}

describe("unload-mcp releases what the host started", () => {
	it("stops the server on the host, not just the connection", async () => {
		const host = recordingHost();
		const interp = await loaded(host);
		await runAsync(interp, '(unload-mcp "fx")');
		await vi.waitFor(() => {
			expect(host.stopped).toEqual(["fx"]);
		});
		interp.dispose();
	}, 30_000);

	it("stops every loaded server on (mcp-shutdown)", async () => {
		const host = recordingHost();
		const interp = await loaded(host);
		await runAsync(interp, "(mcp-shutdown)");
		await vi.waitFor(() => {
			expect(host.stopped).toEqual(["fx"]);
			expect(host.stoppedAll).toBe(1);
		});
		interp.dispose();
	}, 30_000);
});
