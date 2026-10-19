import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ImageError, restore, snapshot } from "../src/image.ts";
import { Interp } from "../src/lisp.ts";
import { newSym } from "../src/objects.ts";
import type { LispPromise } from "../src/promise.ts";
import { ev, freshInterp, imageOf } from "./helpers.ts";

function waitFor(
	calls: unknown[][],
	body: (x: unknown) => Promise<unknown>,
): (interp: Interp) => void {
	return (interp) =>
		interp.defResumable(
			"wait-for",
			1,
			"(wait-for x)",
			"",
			z.tuple([z.unknown()]),
			([x]) => {
				calls.push([x]);
				return body(x);
			},
		);
}

const never = (): Promise<unknown> => new Promise(() => {});

function pendingImage() {
	const calls: unknown[][] = [];
	const interp = freshInterp({ extensions: [waitFor(calls, never)] });
	ev("(setq p (wait-for 7) holder (list p))", interp);
	return { image: imageOf(interp), calls };
}

describe("a value kind", () => {
	it("saves the values it claims and restores them", () => {
		class Handle {
			constructor(readonly id: string) {}
		}
		const handles = (interp: Interp): void =>
			interp.recovery.kind({
				name: "handle",
				claims: (x) => x instanceof Handle,
				save: (x) => ({ id: (x as Handle).id }),
				restore: (data) => new Handle((data as { id: string }).id),
			});
		const interp = freshInterp({ extensions: [handles] });
		interp.defineGlobal(newSym("h"), new Handle("a"));
		ev("(setq both (list h h))", interp);
		const back = new Interp({ extensions: [handles] });
		restore(back, imageOf(interp));
		expect(back.getGlobal(newSym("h"))).toEqual(new Handle("a"));
		expect(ev("(and (eq h (car both)) (eq h (cadr both)))", back)).toBe("t");
	});
});

describe("the phases around an image", () => {
	it("runs afterRestore in registration order once the globals are loaded, isolating a throw", () => {
		const seen: string[] = [];
		const phases = (interp: Interp): void => {
			interp.recovery.afterRestore("first", () => {
				seen.push(`first ${ev("(sq 3)", interp)}`);
			});
			interp.recovery.afterRestore("broken", () => {
				throw new Error("it broke");
			});
			interp.recovery.afterRestore("last", () => {
				seen.push("last");
			});
		};
		const interp = freshInterp();
		ev("(defun sq (x) (* x x))", interp);
		const { failed } = restore(
			new Interp({ extensions: [phases] }),
			imageOf(interp),
		);
		expect(seen).toEqual(["first 9", "last"]);
		expect(failed).toEqual([{ name: "broken", reason: "it broke" }]);
	});

	it("runs beforeSave in reverse registration order", () => {
		const seen: string[] = [];
		const interp = freshInterp();
		interp.recovery.beforeSave("first", () => seen.push("first"));
		interp.recovery.beforeSave("second", () => seen.push("second"));
		snapshot(interp);
		expect(seen).toEqual(["second", "first"]);
	});

	it("aborts the snapshot on a beforeSave that throws, naming it", () => {
		const seen: string[] = [];
		const interp = freshInterp();
		interp.recovery.beforeSave("first", () => seen.push("first"));
		interp.recovery.beforeSave("guard", () => {
			throw new Error("busy");
		});
		expect(() => snapshot(interp)).toThrow(ImageError);
		expect(() => snapshot(interp)).toThrow("guard refused the save: busy");
		expect(seen).toEqual([]);
	});

	it("refuses a name registered twice", () => {
		const { recovery } = new Interp();
		recovery.kind({ name: "k", restore: (d) => d });
		recovery.resumable("r", async () => null);
		recovery.beforeSave("s", () => {});
		recovery.afterRestore("a", () => {});
		expect(() => recovery.kind({ name: "k", restore: (d) => d })).toThrow(
			"k is already registered",
		);
		expect(() => recovery.resumable("r", async () => null)).toThrow(
			"r is already registered",
		);
		expect(() => recovery.beforeSave("s", () => {})).toThrow(
			"s is already registered",
		);
		expect(() => recovery.afterRestore("a", () => {})).toThrow(
			"a is already registered",
		);
	});
});

describe("restoring an image", () => {
	it("refuses an image whose kinds nobody restores, naming them", () => {
		class Handle {}
		const handles = (interp: Interp): void =>
			interp.recovery.kind({
				name: "handle",
				claims: (x) => x instanceof Handle,
				save: () => null,
				restore: () => new Handle(),
			});
		const interp = freshInterp({
			extensions: [handles, waitFor([], never)],
		});
		interp.defineGlobal(newSym("h"), new Handle());
		ev("(setq p (wait-for 1))", interp);
		expect(() => restore(new Interp(), imageOf(interp))).toThrow(
			"no extension restores handle, wait-for",
		);
	});

	it("re-runs a pending resumable call and fulfils the same promise", async () => {
		const { image, calls } = pendingImage();
		expect(calls).toEqual([[7n]]);
		const resumed: unknown[][] = [];
		const back = new Interp({
			extensions: [waitFor(resumed, async (x) => x)],
		});
		restore(back, image);
		const p = back.getGlobal(newSym("p")) as LispPromise;
		expect(p.state).toBe("pending");
		expect(await p).toBe(7n);
		expect(p.state).toBe("fulfilled");
		expect(resumed).toEqual([[7n]]);
		expect(ev("(eq p (car holder))", back)).toBe("t");
	});

	it("rejects a pending promise that carries no recipe", async () => {
		const interp = freshInterp({ extensions: [waitFor([], never)] });
		interp.defPromise("plain", 0, "(plain)", "", z.tuple([]), never);
		ev("(setq kept (wait-for 1) lost (plain))", interp);
		const back = new Interp({
			extensions: [waitFor([], async (x) => x)],
		});
		restore(back, imageOf(interp));
		const lost = back.getGlobal(newSym("lost")) as LispPromise;
		expect(lost.state).toBe("rejected");
		await expect(lost.promise()).rejects.toThrow("interrupted by restore");
		expect(await (back.getGlobal(newSym("kept")) as LispPromise)).toBe(1n);
	});

	it("restores the same image into two interpreters", async () => {
		const { image } = pendingImage();
		const backs = [0, 1].map(() => {
			const back = new Interp({
				extensions: [waitFor([], async (x) => x)],
			});
			restore(back, image);
			return back;
		});
		const [a, b] = backs.map((back) => back.getGlobal(newSym("p")));
		expect(a).not.toBe(b);
		expect(await (a as LispPromise)).toBe(7n);
		expect(await (b as LispPromise)).toBe(7n);
	});
});
