import { BuiltInFunc } from "@repo/interpreter/func";
import type { Image } from "@repo/interpreter/image";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { MAX_DELTA_RUN, MemoryImageStore } from "../src/image-store.ts";
import { MemoryRepl } from "../src/repl.ts";

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

function breaking(): InterpExtension {
	return Object.assign((_: Interp) => {}, {
		session(hooks: SessionHooks): void {
			hooks.stepOutput.use((ctx, out, next) => {
				if (ctx.code.includes("boom")) throw new Error("host broke");
				return next(ctx, out);
			});
		},
	});
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

	it("recovers to the last checkpoint after a step the host broke on", async () => {
		const images = new MemoryImageStore();
		const r = repl(images, [breaking()]);
		await r.evalOutput("(setq a 1)");
		await expect(r.evalOutput("(progn (setq a 2) 'boom)")).rejects.toThrow(
			"host broke",
		);
		expect(r.interp.getGlobal(newSym("a"))).toBe(2n);
		expect(await r.recover()).toBe(1);
		expect(r.interp.getGlobal(newSym("a"))).toBe(1n);
		await r.evalOutput("(setq b 3)", "after");
		await settle();
		expect((await images.latest())?.depth).toBe(2);
	});

	it("resets when there is no checkpoint to recover to", async () => {
		const r = new MemoryRepl({ extensions: [breaking()] });
		await r.evalOutput("(setq a 1)");
		expect(await r.recover()).toBeUndefined();
		expect(r.interp.hasGlobal(newSym("a"))).toBe(false);
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
});
