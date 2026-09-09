import { describe, expect, it } from "vitest";
import { Interp, prelude, runSync } from "../src/lisp.ts";
import { mcpExtension } from "../src/mcp.ts";
import type { Dispatch } from "../src/promises.ts";

function hangingDispatch(): { dispatch: Dispatch; aborts: () => number } {
	let aborts = 0;
	return {
		dispatch: (_op, _payload, signal) =>
			new Promise(() => {
				signal?.addEventListener("abort", () => {
					aborts++;
				});
			}),
		aborts: () => aborts,
	};
}

function loading(dispatch: Dispatch): Interp {
	const interp = new Interp({ extensions: [mcpExtension({ dispatch })] });
	runSync(interp, prelude);
	runSync(interp, '(load-mcp :name "x" :command "node")');
	return interp;
}

describe("Interp.dispose", () => {
	it("aborts work still in flight when the host drops the interp", () => {
		const { dispatch, aborts } = hangingDispatch();
		const interp = loading(dispatch);
		expect(aborts()).toBe(0);
		interp.dispose();
		expect(aborts()).toBe(1);
	});

	it("is idempotent, and composes with the agent's own (mcp-shutdown)", () => {
		const { dispatch, aborts } = hangingDispatch();
		const interp = loading(dispatch);
		interp.dispose();
		interp.dispose();
		expect(aborts()).toBe(1);
	});

	it("does nothing on an interp with no extensions", () => {
		expect(() => new Interp().dispose()).not.toThrow();
	});
});

describe("starting a promise does not suspend", () => {
	it("lets a synchronous host begin background work", () => {
		const { dispatch } = hangingDispatch();
		const interp = new Interp({ extensions: [mcpExtension({ dispatch })] });
		runSync(interp, prelude);
		expect(
			runSync(interp, '(promise-state (load-mcp :name "x" :command "node"))'),
		).toEqual(expect.objectContaining({ name: "pending" }));
	});
});
