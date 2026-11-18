import { BuiltInFunc } from "@repo/interpreter/func";
import type { Image } from "@repo/interpreter/image";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { entryKind, every } from "@repo/shared/journal";
import { describe, expect, it } from "vitest";
import { z } from "zod";
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

function breaking(): InterpExtension {
	return Object.assign((_: Interp) => {}, {
		session(hooks: SessionHooks): void {
			hooks.evalStep.use(async (ctx, next) => {
				await next(ctx);
				if (ctx.code.includes("boom")) throw new Error("host broke");
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

	it("never reuses a journal entry's id across a resume", async () => {
		const stamped = entryKind({
			name: "stamped",
			schema: z.null(),
			fold: every,
		});
		const stamp: InterpExtension = (interp: Interp): void => {
			interp.defineGlobal(
				newSym("stamp"),
				new BuiltInFunc("stamp", 0, () => {
					interp.journal.write(stamped, null);
					return null;
				}),
			);
		};
		const images = new MemoryImageStore();
		const first = repl(images, [stamp]);
		const ids = [
			...(await first.evalOutput("(stamp)")).entries,
			...(await first.evalOutput("(stamp)")).entries,
		].map((entry) => entry.id);
		await settle();
		const second = repl(images, [stamp]);
		await second.resume();
		ids.push(...(await second.evalOutput("(stamp)")).entries.map((e) => e.id));
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
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
		expect(out.notes).toEqual([]);
	});

	it("recovers to the last checkpoint after a step the host broke on", async () => {
		const images = new MemoryImageStore();
		const r = repl(images, [breaking()]);
		await r.evalOutput("(setq a 1)");
		await expect(r.evalOutput("(progn (setq a 2) 'boom)")).rejects.toThrow(
			"host broke",
		);
		expect(await r.recover()).toBe(1);
		expect((await r.evalOutput("(echo a)")).user).toBe("1\n");
		await r.evalOutput("(setq b 3)", "after");
		await settle();
		const resumed = repl(images);
		await resumed.resume();
		expect((await resumed.evalOutput("(echo (list a b))")).user).toBe(
			"(1 3)\n",
		);
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
		expect((await r.evalOutput("(setq a 1)")).notes).toEqual([]);
		await r.evalOutput("(setq a 2)", "second");
		await settle();
		expect(images.origins()).toEqual(["second"]);
		const resumed = repl(images);
		await resumed.resume();
		expect((await resumed.evalOutput("(echo a)")).user).toBe("2\n");
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
		expect((await resumed.evalOutput("(echo (list v0 v34))")).user).toBe(
			"(nil 34)\n",
		);
	});

	it("keeps the conversation globals in the image, still sealed", async () => {
		const images = new MemoryImageStore();
		const first = new AgentRepl({ extensions: [], images });
		first.seed([{ role: "user", content: "hi" }], 0);
		await first.evalOutput("(setq seen (length user-messages))");
		await settle();
		const second = new AgentRepl({ extensions: [], images });
		await second.resume();
		expect((await second.evalOutput("(echo seen)")).user).toBe("1\n");
		expect((await second.evalOutput("(setq user-messages nil)")).failed).toBe(
			true,
		);
	});
});
