import { fileURLToPath } from "node:url";
import { Interp, prelude, runAsync, runSync } from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { describe, expect, it, vi } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { recordingHost } from "./helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

async function loaded(host: ReturnType<typeof recordingHost>): Promise<Interp> {
	const interp = new Interp({
		extensions: [
			promisesExtension(promisesHost),
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
