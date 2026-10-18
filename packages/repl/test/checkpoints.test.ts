import { BuiltInFunc } from "@repo/interpreter/func";
import type { Image } from "@repo/interpreter/image";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { MAX_DELTA_RUN, MemoryImageStore } from "../src/image-store.ts";
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

function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("checkpoints", () => {
	it("layers every call, ui answers included, under the origin it ran for", async () => {
		const answers: InterpExtension = Object.assign((_: Interp) => {}, {
			session(hooks: SessionHooks): void {
				hooks.invoke.use(async () => {});
			},
		});
		const images = new MemoryImageStore();
		const r = repl(images, [answers]);
		await r.evalOutput("(setq a 1)", "first");
		await r.evalOutput("(setq b 2)", "second");
		await r.invokeUi("nothing");
		await settle();
		expect(images.origins()).toEqual(["first", "second", undefined]);
		expect((await images.latest())?.depth).toBe(3);
	});

	it("stamps a step's channel envelopes with its depth, across a resume", async () => {
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
		await settle();
		const second = repl(images, [stamp]);
		await second.resume();
		await second.evalOutput("(stamp)");
		expect(steps).toEqual([1, 2, 3]);
	});

	it("resumes in a new REPL where the last one stopped", async () => {
		const images = new MemoryImageStore();
		const first = repl(images);
		await first.evalOutput(
			"(setq counter (let ((n 0)) (lambda () (setq n (+ n 1)))))",
		);
		await first.evalOutput("(counter)");
		await settle();
		const second = repl(images);
		expect(await second.resume()).toBe(2);
		expect((await second.evalOutput("(echo (counter))")).user).toBe("2\n");
	});

	it("resumes nothing from an empty store", async () => {
		expect(await repl().resume()).toBeUndefined();
	});

	it("layers nothing it could not checkpoint, and tells the model nothing", async () => {
		const images = new MemoryImageStore();
		const r = repl(images, [opaque()]);
		const out = await r.evalOutput("(setq h (opaque))");
		await settle();
		expect(images.origins()).toEqual([]);
		expect(out.message).toBeUndefined();
	});

	it("keeps checkpointing after a save fails", async () => {
		class FlakyStore extends MemoryImageStore {
			private failed = false;
			override async save(image: Image, origin?: string) {
				if (!this.failed) {
					this.failed = true;
					throw new Error("disk full");
				}
				return super.save(image, origin);
			}
		}
		const images = new FlakyStore();
		const r = repl(images);
		expect((await r.evalOutput("(setq a 1)")).message).toBeUndefined();
		await r.evalOutput("(setq a 2)", "second");
		await settle();
		expect(images.origins()).toEqual(["second"]);
		const resumed = repl(images);
		await resumed.resume();
		expect(resumed.interp.getGlobal(newSym("a"))).toBe(2n);
	});

	it("saves what changed after the last call when it closes", async () => {
		const images = new MemoryImageStore();
		const first = repl(images);
		await first.evalOutput("(setq a 1)");
		first.interp.defineGlobal(newSym("late"), 5n);
		await first.close();
		expect(images.origins()).toEqual([undefined, undefined]);
		const second = repl(images);
		expect(await second.resume()).toBe(2);
		expect(second.interp.getGlobal(newSym("late"))).toBe(5n);
	});

	it("finishes the running call before it closes", async () => {
		const images = new MemoryImageStore();
		const first = repl(images);
		const running = first.evalOutput("(setq a 1)", "first");
		await first.close();
		expect((await running).failed).toBe(false);
		expect(images.origins()).toEqual(["first", undefined]);
		const second = repl(images);
		expect(await second.resume()).toBe(2);
		expect(second.interp.getGlobal(newSym("a"))).toBe(1n);
	});

	it("disposes its interpreter when it closes", async () => {
		let disposed = 0;
		const watched: InterpExtension = (interp: Interp): void => {
			interp.hooks.dispose.use((next) => {
				disposed++;
				next();
			});
		};
		const r = repl(new MemoryImageStore(), [watched]);
		await r.evalOutput("(setq a 1)");
		await r.close();
		expect(disposed).toBe(1);
	});

	it("saves nothing when it closes before its first call", async () => {
		const images = new MemoryImageStore();
		await repl(images).close();
		expect(await images.latest()).toBeUndefined();
	});

	it("rebuilds the image from a run of layers past the cap", async () => {
		const images = new MemoryImageStore();
		const r = repl(images);
		for (let n = 0; n < MAX_DELTA_RUN + 3; n++)
			await r.evalOutput(`(setq v${n} ${n})`);
		await r.evalOutput("(setq v0 nil)");
		await settle();
		const resumed = repl(images);
		expect(await resumed.resume()).toBe(MAX_DELTA_RUN + 4);
		expect(resumed.interp.getGlobal(newSym("v0"))).toBeNull();
		expect(resumed.interp.getGlobal(newSym("v34"))).toBe(34n);
	});

	it("keeps the conversation globals in the image, still sealed", async () => {
		const images = new MemoryImageStore();
		const first = new AgentRepl({ extensions: [], images });
		first.setConversationVars({ "user-messages": ["hi"] });
		await first.evalOutput("(setq seen (length user-messages))");
		await settle();
		const second = new AgentRepl({ extensions: [], images });
		await second.resume();
		expect(second.interp.getGlobal(newSym("seen"))).toBe(1n);
		expect((await second.evalOutput("(setq user-messages nil)")).failed).toBe(
			true,
		);
	});
});
