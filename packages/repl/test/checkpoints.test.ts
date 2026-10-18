import { BuiltInFunc } from "@repo/interpreter/func";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { type Checkpoint, MemoryImageStore } from "../src/image-store.ts";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

function repl(
	images = new MemoryImageStore(),
	extensions: InterpExtension[] = [],
): MemoryRepl {
	return new MemoryRepl({ extensions, images });
}

function opaque(): InterpExtension {
	return (interp: Interp): void => {
		interp.defineGlobal(
			newSym("opaque"),
			new BuiltInFunc("opaque", 0, () => new Map()),
		);
	};
}

describe("checkpoints", () => {
	it("numbers every call, ui answers included", async () => {
		const answers: InterpExtension = Object.assign((_: Interp) => {}, {
			session(hooks: SessionHooks): void {
				hooks.invoke.use(async () => {});
			},
		});
		const r = repl(new MemoryImageStore(), [answers]);
		expect((await r.evalOutput("(setq a 1)")).call).toBe(1);
		expect((await r.evalOutput("(setq b 2)")).call).toBe(2);
		expect((await r.invokeUi("nothing")).call).toBe(3);
		expect(r.call).toBe(3);
	});

	it("stamps a step's channel envelopes with its call, across a revert", async () => {
		const steps: number[] = [];
		const stamp: InterpExtension = (interp: Interp): void => {
			interp.defineGlobal(
				newSym("stamp"),
				new BuiltInFunc("stamp", 0, () => {
					steps.push(interp.channels.step);
					return null;
				}),
			);
		};
		const r = repl(new MemoryImageStore(), [stamp]);
		await r.evalOutput("(stamp)");
		await r.evalOutput("(stamp)");
		await r.evalOutput("(stamp)");
		await r.revert(2);
		await r.evalOutput("(stamp)");
		expect(steps).toEqual([1, 2, 3, 3]);
	});

	it("reverts to a call, dropping what came after it", async () => {
		const images = new MemoryImageStore();
		const r = repl(images);
		await r.evalOutput("(defun sq (x) (* x x))");
		await r.evalOutput("(defun cube (x) (* x x x))");
		expect(await r.revert(1)).toBe(1);
		expect(await images.at(2)).toBeUndefined();
		expect((await r.evalOutput("(echo (sq 3))")).user).toBe("9\n");
		expect((await r.evalOutput("(cube 3)")).failed).toBe(true);
		expect(r.call).toBe(3);
	});

	it("runs a call made during a revert on the reverted interpreter", async () => {
		let release = (): void => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		class SlowStore extends MemoryImageStore {
			override async at(call: number) {
				await gate;
				return super.at(call);
			}
		}
		const r = repl(new SlowStore());
		await r.evalOutput("(setq a 1)");
		await r.evalOutput("(setq a 2)");
		const reverting = r.revert(1);
		const after = r.evalOutput("(echo a)");
		release();
		await reverting;
		expect(await after).toMatchObject({ user: "1\n", call: 2 });
	});

	it("numbers no call when it keeps no checkpoints", async () => {
		const r = new MemoryRepl({ extensions: [] });
		expect((await r.evalOutput("(setq a 1)")).call).toBeUndefined();
	});

	it("refuses a call it has no checkpoint for", async () => {
		await expect(repl().revert(7)).rejects.toThrow("no checkpoint for call 7");
	});

	it("resumes in a new REPL where the last one stopped", async () => {
		const images = new MemoryImageStore();
		const first = repl(images);
		await first.evalOutput(
			"(setq counter (let ((n 0)) (lambda () (setq n (+ n 1)))))",
		);
		await first.evalOutput("(counter)");
		const second = repl(images);
		expect(await second.resume()).toBe(2);
		expect((await second.evalOutput("(echo (counter))")).user).toBe("2\n");
		expect(second.call).toBe(3);
	});

	it("resumes nothing from an empty store", async () => {
		expect(await repl().resume()).toBeUndefined();
	});

	it("numbers no call it could not checkpoint, and tells the model nothing", async () => {
		const r = repl(new MemoryImageStore(), [opaque()]);
		const out = await r.evalOutput("(setq h (opaque))");
		expect(out.call).toBeUndefined();
		expect(out.message).toBeUndefined();
	});

	it("keeps checkpointing after a save fails", async () => {
		class FlakyStore extends MemoryImageStore {
			private failed = false;
			override async save(checkpoint: Checkpoint) {
				if (!this.failed) {
					this.failed = true;
					throw new Error("disk full");
				}
				return super.save(checkpoint);
			}
		}
		const images = new FlakyStore();
		const r = repl(images);
		expect((await r.evalOutput("(setq a 1)")).message).toBeUndefined();
		await r.evalOutput("(setq a 2)");
		await expect(r.revert(1)).rejects.toThrow("no checkpoint for call 1");
		await r.revert(2);
		expect(await images.at(1)).toBeUndefined();
		expect((await r.evalOutput("(echo a)")).user).toBe("2\n");
	});

	it("keeps the call count across a reset", async () => {
		const r = repl();
		await r.evalOutput("(setq a 1)");
		r.reset();
		expect((await r.evalOutput("(setq a 2)")).call).toBe(2);
	});

	it("keeps the conversation globals in the image, still sealed", async () => {
		const images = new MemoryImageStore();
		const first = new AgentRepl({ extensions: [], images });
		first.setConversationVars({ "user-messages": ["hi"] });
		await first.evalOutput("(setq seen (length user-messages))");
		const second = new AgentRepl({ extensions: [], images });
		await second.resume();
		expect(second.interp.getGlobal(newSym("seen"))).toBe(1n);
		expect((await second.evalOutput("(setq user-messages nil)")).failed).toBe(
			true,
		);
	});
});
