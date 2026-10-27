import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { describe, expect, it, vi } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";
import type { McpHost } from "../src/ports.ts";
import { recordingHost } from "./helpers.ts";

function interpOn(host: McpHost): Interp {
	const interp = new Interp({
		extensions: [
			mcpExtension({
				...mcpHost,
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

describe("load-mcp :local", () => {
	it("marks a command server :local for the host", async () => {
		const host = recordingHost();
		const interp = interpOn(host);
		await settle(
			interp,
			'(load-mcp :name "fx" :command "definitely-not-a-binary" :local t)',
		);
		expect(host.ensured[0]).toMatchObject({ name: "fx", local: true });
		interp.dispose();
	});

	it("leaves a command server without :local unmarked", async () => {
		const host = recordingHost();
		const interp = interpOn(host);
		await settle(
			interp,
			'(load-mcp :name "fx" :command "definitely-not-a-binary")',
		);
		expect(host.ensured[0]).not.toHaveProperty("local");
		interp.dispose();
	});

	it("sends the transport's requests through the fetch a handle carries", async () => {
		const fetch = vi.fn(async () => {
			throw new Error("bridged");
		});
		const host: McpHost = {
			...recordingHost(),
			ensure: async () => ({ url: "http://desktop.bridge/fx/mcp", fetch }),
		};
		const interp = interpOn(host);
		await settle(interp, '(load-mcp :name "fx" :command "anything" :local t)');
		expect(fetch).toHaveBeenCalled();
		expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
			"http://desktop.bridge/fx/mcp",
		);
		interp.dispose();
	});
});
