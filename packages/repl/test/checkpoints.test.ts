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

	it("stamps a step's channel envelopes with its call, across a resume", async () => {
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
		const images = new MemoryImageStore();
		const first = repl(images, [stamp]);
		await first.evalOutput("(stamp)");
		await first.evalOutput("(stamp)");
		const second = repl(images, [stamp]);
		await second.resume();
		await second.evalOutput("(stamp)");
		expect(steps).toEqual([1, 2, 3]);
	});

	it("numbers no call when it keeps no checkpoints", async () => {
		const r = new MemoryRepl({ extensions: [] });
		expect((await r.evalOutput("(setq a 1)")).call).toBeUndefined();
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
		expect((await r.evalOutput("(setq a 2)")).call).toBe(2);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((await images.latest())?.call).toBe(2);
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
