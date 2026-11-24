import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type Image, ImageError, restore } from "../src/image.ts";
import { type Installable, Interp, runSync } from "../src/lisp.ts";
import { newSym } from "../src/objects.ts";
import {
	ev,
	evAsync,
	freshInterp,
	imageOf,
	roundTrip,
	withSettle,
} from "./helpers.ts";

function waitFor(
	body: (x: unknown) => Promise<unknown>,
): (interp: Interp) => void {
	return (interp) =>
		interp.defResumable(
			"wait-for",
			1,
			"(wait-for x)",
			"",
			z.tuple([z.unknown()]),
			([x]) => body(x),
		);
}

const never = (): Promise<unknown> => new Promise(() => {});
const echo = async (x: unknown): Promise<unknown> => x;

function pendingImage() {
	const interp = freshInterp({ extensions: [waitFor(never)] });
	ev("(setq p (wait-for 7) holder (list p))", interp);
	return imageOf(interp);
}

function restoredWith(image: Image, ...extensions: Installable[]): Interp {
	const back = new Interp({ extensions });
	restore(back, image);
	return withSettle(back);
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
		const phases = (interp: Interp): void => {
			interp.recovery.afterRestore("first", () => {
				runSync(interp, "(setq seen (list (sq 3)))");
			});
			interp.recovery.afterRestore("broken", () => {
				throw new Error("it broke");
			});
			interp.recovery.afterRestore("last", () => {
				runSync(interp, "(setq seen (cons 'last seen))");
			});
		};
		const interp = freshInterp();
		ev("(defun sq (x) (* x x))", interp);
		const back = new Interp({ extensions: [phases] });
		const { failed } = restore(back, imageOf(interp));
		expect(ev("seen", back)).toBe("(last 9)");
		expect(failed).toEqual([{ name: "broken", reason: "it broke" }]);
	});

	it("runs an extension's beforeSave steps last registered first, and the image keeps what they set", () => {
		const saving = (interp: Interp): void => {
			interp.recovery.beforeSave("first", () => {
				runSync(interp, "(setq order (cons 'first order))");
			});
			interp.recovery.beforeSave("second", () => {
				runSync(interp, "(setq order (cons 'second order))");
			});
		};
		const interp = freshInterp({ extensions: [saving] });
		ev("(setq order nil)", interp);
		expect(ev("order", roundTrip(interp))).toBe("(first second)");
	});

	it("aborts the snapshot on a beforeSave that throws, naming it", () => {
		const interp = freshInterp();
		interp.recovery.beforeSave("guard", () => {
			throw new Error("busy");
		});
		expect(() => imageOf(interp)).toThrow(ImageError);
		expect(() => imageOf(interp)).toThrow(/guard/);
	});

	it.each([
		[
			"a kind",
			(i: Interp) => i.recovery.kind({ name: "k", restore: (d) => d }),
		],
		["a resumable", (i: Interp) => i.recovery.resumable("k", async () => null)],
		["a beforeSave", (i: Interp) => i.recovery.beforeSave("k", () => {})],
		["an afterRestore", (i: Interp) => i.recovery.afterRestore("k", () => {})],
	])("refuses %s registered twice under one name", (_, register) => {
		expect(() => new Interp({ extensions: [register, register] })).toThrow(
			"k is already registered",
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
		const interp = freshInterp({ extensions: [handles, waitFor(never)] });
		interp.defineGlobal(newSym("h"), new Handle());
		ev("(setq p (wait-for 1))", interp);
		expect(() => roundTrip(interp)).toThrow(
			"no extension restores handle, wait-for",
		);
	});

	it("re-runs a pending resumable call and fulfils the same promise", async () => {
		const back = restoredWith(pendingImage(), waitFor(echo));
		expect(await evAsync("(settle p)", back)).toBe("7");
		expect(ev("(eq p (car holder))", back)).toBe("t");
	});

	it("rejects a pending promise that carries no recipe", async () => {
		const interp = freshInterp({ extensions: [waitFor(never)] });
		interp.defPromise("plain", 0, "(plain)", "", z.tuple([]), never);
		ev("(setq kept (wait-for 1) lost (plain))", interp);
		const back = restoredWith(imageOf(interp), waitFor(echo));
		await expect(evAsync("(settle lost)", back)).rejects.toThrow(
			"interrupted by restore",
		);
		expect(await evAsync("(settle kept)", back)).toBe("1");
	});

	it("restores the same image into two interpreters", async () => {
		const image = pendingImage();
		const a = restoredWith(image, waitFor(echo));
		const b = restoredWith(image, waitFor(echo));
		expect(await evAsync("(settle p)", a)).toBe("7");
		expect(await evAsync("(settle p)", b)).toBe("7");
	});
});
