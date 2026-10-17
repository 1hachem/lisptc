import { BuiltInFunc } from "@repo/interpreter/func";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import { MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl } from "@repo/repl/repl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Closed, ReplStore } from "../src/repl-store.ts";
import { testRepl, testRepls } from "./helpers.ts";

describe("the store a host keeps its threads in", () => {
	it("hands the same thread the same repl on a later turn", async () => {
		const repls = testRepls();
		await (await repls.get("thread-a")).eval("(setq x 41)");

		expect(
			(await (await repls.get("thread-a")).evalOutput("(echo x)")).user,
		).toBe("41\n");
	});

	it("gives another thread a repl of its own", async () => {
		const repls = testRepls();
		await (await repls.get("thread-b")).eval("(setq x 41)");

		expect(await (await repls.get("thread-c")).eval("(echo x)")).toContain(
			"void variable: x",
		);
	});

	it("opens a thread once, however many turns race for it", async () => {
		let opened = 0;
		const repls = new ReplStore(async (): Promise<AgentRepl> => {
			opened += 1;
			await Promise.resolve();
			return testRepl();
		});

		const [one, another] = await Promise.all([
			repls.get("thread-d"),
			repls.get("thread-d"),
		]);

		expect(opened).toBe(1);
		expect(one).toBe(another);
	});

	it("does not build a repl for a thread nobody has opened", () => {
		expect(testRepls().peek("thread-e")).toBeUndefined();
	});
});

const IDLE = 1000;

function savedRepls(
	extensions: ((interp: Interp) => void)[] = [],
	closed?: (threadId: string, closed: Closed) => void,
) {
	const images = new MemoryImageStore();
	return new ReplStore(
		async (): Promise<AgentRepl> => {
			const repl = new AgentRepl({ extensions, images });
			await repl.resume();
			return repl;
		},
		{ idleMs: IDLE, closed },
	);
}

function gated(): { extension: (interp: Interp) => void; open: () => void } {
	let open = (): void => {};
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	const extension = (interp: Interp): void => {
		interp.defineGlobal(
			newSym("slow"),
			new BuiltInFunc("slow", 0, () => "ran"),
		);
		interp.hooks.call.use((i, name, args, next) =>
			name === "slow"
				? gate.then(() => next(i, name, args))
				: next(i, name, args),
		);
	};
	return { extension, open: () => open() };
}

describe("a thread left idle", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("stays while it keeps being used", async () => {
		vi.useFakeTimers();
		const repls = savedRepls();
		const first = await repls.get("thread-f");
		await vi.advanceTimersByTimeAsync(IDLE * 0.75);
		await repls.get("thread-f");
		await vi.advanceTimersByTimeAsync(IDLE * 0.75);

		expect(repls.peek("thread-f")).toBe(first);
	});

	it("is saved, closed and reopened where it stopped", async () => {
		vi.useFakeTimers();
		const repls = savedRepls();
		const first = await repls.get("thread-g");
		await first.eval("(setq x 41)");
		first.interp.defineGlobal(newSym("late"), 1n);
		await vi.advanceTimersByTimeAsync(IDLE + 1);

		expect(repls.peek("thread-g")).toBeUndefined();
		const second = await repls.get("thread-g");
		expect(second).not.toBe(first);
		expect((await second.evalOutput("(echo (+ x late))")).user).toBe("42\n");
	});

	it("tells the host once it is closed", async () => {
		vi.useFakeTimers();
		const told: [string, Closed][] = [];
		const repls = savedRepls([], (threadId, closed) => {
			told.push([threadId, closed]);
		});
		await (await repls.get("thread-i")).eval("(setq x 1)");
		await vi.advanceTimersByTimeAsync(IDLE + 1);

		expect(told).toEqual([["thread-i", { saved: true }]]);
	});

	it("is not closed while a call is still running", async () => {
		vi.useFakeTimers();
		const { extension, open } = gated();
		const repls = savedRepls([extension]);
		const repl = await repls.get("thread-h");
		const running = repl.evalOutput("(slow)");
		await vi.advanceTimersByTimeAsync(IDLE * 3);

		expect(repls.peek("thread-h")).toBe(repl);
		open();
		await running;
		await vi.advanceTimersByTimeAsync(IDLE + 1);
		expect(repls.peek("thread-h")).toBeUndefined();
	});
});
