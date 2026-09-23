import { fileURLToPath } from "node:url";
import {
	Interp,
	prelude,
	runAsync,
	runSync,
	str,
} from "@repo/interpreter/lisp";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { envSecretsStore, secretsHost } from "@repo/secrets-extension/host";
import { afterAll, describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

describe("secret registry (revealed only into an MCP call)", () => {
	const store = envSecretsStore();
	store.set({ REPL_FOO: "s3cr3t" });
	const interp = new Interp({
		extensions: [
			secretsExtension({ ...secretsHost, store }),
			promisesExtension(promisesHost),
			mcpExtension(mcpHost),
		],
	});
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("passes the real (and composed) value into an MCP tool call", async () => {
		await runAsync(
			interp,
			`(await (load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}"))))`,
		);
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
	});
});
