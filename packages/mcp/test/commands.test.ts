import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";
import type { McpHost } from "../src/ports.ts";
import { recordingHost } from "./helpers.ts";

function interpOn(host: McpHost, commands?: boolean): Interp {
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
				...(commands === undefined ? {} : { commands }),
				client: localMcpClient({ host, oauth: new MemoryOAuthStore() }),
			}),
		],
	});
	runSync(interp, prelude);
	return interp;
}

async function settle(interp: Interp, code: string): Promise<void> {
	await Promise.resolve(runSync(interp, code)).catch(() => undefined);
}

describe("load-mcp :command", () => {
	it.each([
		'(load-mcp :name "fx" :command "x")',
		'(load-mcp :name "fx" :args (quote ("a")))',
		'(load-mcp :name "fx" :env (quote (("A" . "1"))))',
		'(load-mcp "fx" :command "x" :local t)',
	])("refuses %s unless the host allows commands", (code) => {
		const host = recordingHost();
		const interp = interpOn(host);
		expect(() => runSync(interp, code)).toThrow(/not supported/);
		expect(host.ensured).toEqual([]);
		interp.dispose();
	});

	it("still loads a remote server by :url", async () => {
		const host = recordingHost();
		const interp = interpOn(host);
		await settle(
			interp,
			'(load-mcp :name "remote" :url "http://127.0.0.1:1/mcp")',
		);
		expect(host.ensured[0]).toMatchObject({
			name: "remote",
			url: "http://127.0.0.1:1/mcp",
		});
		interp.dispose();
	});

	it("loads a :command when the host allows commands", async () => {
		const host = recordingHost();
		const interp = interpOn(host, true);
		await settle(
			interp,
			'(load-mcp :name "fx" :command "definitely-not-a-binary" :args (quote ("a")))',
		);
		expect(host.ensured[0]).toMatchObject({
			name: "fx",
			command: "definitely-not-a-binary",
			args: ["a"],
		});
		interp.dispose();
	});
});
