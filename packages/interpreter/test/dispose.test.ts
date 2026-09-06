import { describe, expect, it } from "vitest";
import type { JobsRuntime } from "../src/jobs.ts";
import { Interp } from "../src/lisp.ts";
import { mcpExtension } from "../src/mcp.ts";

// A JobsRuntime that does nothing but remember whether it was shut down. The
// real one owns a worker thread; all this test needs to know is whether anyone
// told it to let go.
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

/*
 * Teardown a host asks for.
 *
 * `(mcp-shutdown)` is the agent's own path to this and stays exactly as it was;
 * what the `dispose` hook adds is the path for a host that drops an interp
 * without the agent having said anything — a REPL `reset()`, which used to
 * strand the broker worker it had spun up.
 */
describe("Interp.dispose", () => {
	it("shuts the MCP runtime down when the host drops the interp", () => {
		const runtime = countingRuntime();
		const interp = new Interp({ extensions: [mcpExtension({ runtime })] });
		expect(runtime.shutdowns).toBe(0);
		interp.dispose();
		expect(runtime.shutdowns).toBe(1);
	});

	// Both paths may fire — the agent tidies up and the host then resets — so
	// the teardown has to tolerate being run twice.
	it("is idempotent, and composes with the agent's own (mcp-shutdown)", () => {
		const runtime = countingRuntime();
		const interp = new Interp({ extensions: [mcpExtension({ runtime })] });
		interp.dispose();
		interp.dispose();
		expect(runtime.shutdowns).toBe(2);
	});

	// The language owns nothing that needs releasing, so a core interp disposes
	// to a no-op rather than requiring every host to check first.
	it("does nothing on an interp with no extensions", () => {
		expect(() => new Interp().dispose()).not.toThrow();
	});
});
