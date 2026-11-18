import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { describe, expect, it } from "vitest";
import { DockerHost } from "../src/docker-host.ts";
import { mcpExtension } from "../src/mcp.ts";
import { localMcpClient, mcpHost } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";
import { recordingHost } from "./helpers.ts";

describe("the docker host", () => {
	it("hands a server that already speaks http to the fallback", async () => {
		const fallback = recordingHost();
		const interp = new Interp({
			extensions: [
				mcpExtension({
					...mcpHost,
					commands: true,
					client: localMcpClient({
						host: new DockerHost(fallback),
						oauth: new MemoryOAuthStore(),
					}),
				}),
			],
		});
		runSync(interp, prelude);
		await Promise.resolve(
			runSync(
				interp,
				`(load-mcp :name "sheets" :url "http://localhost:8911/mcp")`,
			),
		).catch(() => undefined);
		expect(fallback.ensured).toMatchObject([
			{ name: "sheets", url: "http://localhost:8911/mcp" },
		]);
		interp.dispose();
	});
});
