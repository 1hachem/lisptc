import { describe, expect, it } from "vitest";
import type { JobsRuntime } from "../src/jobs.ts";
import { Interp } from "../src/lisp.ts";
import { mcpExtension } from "../src/mcp.ts";

function countingRuntime(): JobsRuntime & { shutdowns: number } {
	const runtime = {
		shutdowns: 0,
		call: () => undefined,
		start: () => "job-1",
		awaitJob: () => undefined,
		awaitAll: () => ({ results: [] }),
		awaitAny: () => ({ jobId: "job-1", ok: true, value: null }),
		jobStatus: () => "done",
		cancelJob: () => {},
		onSettled: () => {},
		shutdown() {
			runtime.shutdowns++;
		},
	} as unknown as JobsRuntime & { shutdowns: number };
	return runtime;
}

describe("Interp.dispose", () => {
	it("shuts the MCP runtime down when the host drops the interp", () => {
		const runtime = countingRuntime();
		const interp = new Interp({ extensions: [mcpExtension({ runtime })] });
		expect(runtime.shutdowns).toBe(0);
		interp.dispose();
		expect(runtime.shutdowns).toBe(1);
	});

	it("is idempotent, and composes with the agent's own (mcp-shutdown)", () => {
		const runtime = countingRuntime();
		const interp = new Interp({ extensions: [mcpExtension({ runtime })] });
		interp.dispose();
		interp.dispose();
		expect(runtime.shutdowns).toBe(2);
	});

	it("does nothing on an interp with no extensions", () => {
		expect(() => new Interp().dispose()).not.toThrow();
	});
});
