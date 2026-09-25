import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { mcpExtension } from "@repo/mcp-extension";
import { mcpHost } from "@repo/mcp-extension/mcp-host";
import { secretsExtension } from "@repo/secrets-extension";
import { envSecretsStore, secretsHost } from "@repo/secrets-extension/host";
import { afterAll, describe, expect, it } from "vitest";
import { mockMcpClient } from "./helpers.ts";

describe("secret registry (revealed only into an MCP call)", () => {
	const store = envSecretsStore();
	store.set({ REPL_FOO: "s3cr3t" });
	const client = mockMcpClient({ fx: { tools: ["echo"] } });
	const interp = new Interp({
		extensions: [
			secretsExtension({ ...secretsHost, store }),
			mcpExtension({ ...mcpHost, client }),
		],
	});
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("passes the real (and composed) value into an MCP tool call", async () => {
		await (runSync(
			interp,
			'(load-mcp :name "fx" :command "node")',
		) as Promise<unknown>);

		expect(
			str(
				(await runAsync(interp, '(fx/echo :message (secret "REPL_FOO"))'))
					.value,
			),
		).toBe('"s3cr3t"');
		expect(
			str(
				(
					await runAsync(
						interp,
						'(fx/echo :message (concat "Bearer " (secret "REPL_FOO")))',
					)
				).value,
			),
		).toBe('"Bearer s3cr3t"');

		expect(client.calls.map((call) => call.args.message)).toEqual([
			"s3cr3t",
			"Bearer s3cr3t",
		]);
	});

	it("keeps the secret redacted everywhere else", async () => {
		expect(str((await runAsync(interp, '(secret "REPL_FOO")')).value)).toBe(
			"#<secret:REPL_FOO>",
		);
	});
});
