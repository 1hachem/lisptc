import { fileURLToPath } from "node:url";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import type { ConnConfig } from "../src/ports.ts";
import { recordingHost, reportOf } from "./helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

const FX: ConnConfig = {
	name: "fx",
	command: "node",
	args: ["--no-warnings", "--experimental-transform-types", FIXTURE],
};

function withToolkit(): Interp {
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
				client: localMcpClient({ host: recordingHost() }),
				toolkit: { all: () => [FX] },
			}),
		],
	});
	runSync(interp, prelude);
	return interp;
}

describe("a call into a server that is not loaded says so", () => {
	it("names the load that would define the tool", () => {
		const text = reportOf(withToolkit(), '(fx/navigate "https://example.com")');
		expect(text).toContain('(load-mcp "fx")');
	});

	it("claims no name outside the toolkit", () => {
		const text = reportOf(
			withToolkit(),
			'(unheard/navigate "https://example.com")',
		);
		expect(text).not.toContain("load-mcp");
	});

	it("steps aside once the server is loaded", async () => {
		const interp = withToolkit();
		await (runSync(interp, '(load-mcp "fx")') as Promise<unknown>);
		const text = reportOf(interp, "(fx/navigate)");
		expect(text).not.toContain("load-mcp");
		interp.dispose();
	}, 30_000);
});
