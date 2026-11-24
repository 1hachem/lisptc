import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extract, ImageError, implant, snapshot } from "../src/image.ts";
import { Interp, runSync } from "../src/lisp.ts";
import { newSym } from "../src/objects.ts";
import { str } from "../src/print.ts";
import type { LispPromise } from "../src/promise.ts";
import {
	ev,
	evAsync,
	freshInterp,
	imageOf,
	roundTrip,
	withSettle,
} from "./helpers.ts";

function imagedAfter(setup: string): Interp {
	const interp = freshInterp();
	ev(setup, interp);
	return roundTrip(interp);
}

describe("an image", () => {
	it("keeps definitions without running the prelude again", () => {
		const back = imagedAfter("(defun sq (x) (* x x))");
		expect(ev("(sq 4)", back)).toBe("16");
		expect(ev("(when t (mapcar sq '(1 2)))", back)).toBe("(1 4)");
	});

	it("keeps every kind of atom", () => {
		const back = imagedAfter(
			'(setq xs (list 1 2.5 "s" \'sym :key nil t 123456789012345678901234567890))',
		);
		expect(ev("xs", back)).toBe(
			'(1 2.5 "s" sym :key nil t 123456789012345678901234567890)',
		);
	});

	it("keeps floats that JSON cannot spell", () => {
		const back = imagedAfter("(setq big (/ 1 0) small (/ -1 0))");
		expect(ev("(list big small)", back)).toBe("(Infinity -Infinity)");
	});

	it("keeps a frame shared between closures", () => {
		const back = imagedAfter(`
			(setq pair (let ((n 0))
			             (list (lambda () (setq n (+ n 1)))
			                   (lambda () n))))
			((car pair))`);
		ev("((car pair))", back);
		expect(ev("((cadr pair))", back)).toBe("2");
	});

	it("keeps a cycle", () => {
		const back = imagedAfter("(setq ring (list 1 2)) (setcdr (cdr ring) ring)");
		expect(ev("(eq ring (cddr ring))", back)).toBe("t");
	});

	it("keeps an uninterned symbol identical to itself", () => {
		const back = imagedAfter("(setq g (gensym)) (setq gs (list g g))");
		expect(ev("(eq (car gs) (cadr gs))", back)).toBe("t");
		expect(ev("(eq (car gs) g)", back)).toBe("t");
		expect(ev("(eq g 'G1)", back)).toBe("nil");
	});

	it("keeps the gensym counter", () => {
		const back = imagedAfter("(setq *gensym-counter* 100)");
		expect(ev("(gensym)", back)).toBe("#:G100");
	});

	it("keeps macros, docs and sources", () => {
		const back = imagedAfter(`
			(defmacro twice (x) \`(progn ,x ,x))
			(defun sq (x) "Square x." (* x x))`);
		expect(ev("(let ((n 0)) (twice (setq n (+ n 1))) n)", back)).toBe("2");
		expect(back.docs().get("sq")?.doc).toBe("Square x.");
		expect(str(back.sourceOf("sq"))).toContain("(* x x)");
	});

	it("keeps a builtin stored under another name", () => {
		const back = imagedAfter("(setq my-car car)");
		expect(ev("(my-car '(1 2))", back)).toBe("1");
	});

	it("turns a builtin the roster no longer has into one that says so", () => {
		const interp = freshInterp();
		interp.def("gone-soon", 0, "(gone-soon)", "", z.tuple([]), () => 1n);
		ev("(setq kept gone-soon)", interp);
		const back = roundTrip(interp);
		expect(() => ev("(kept)", back)).toThrow("builtin no longer exists");
	});

	it("refuses a value it has no form for", () => {
		const interp = freshInterp();
		interp.defineGlobal(newSym("handle"), new Map());
		expect(() => snapshot(interp)).toThrow(ImageError);
	});

	it("refuses a builtin made at run time with no way back", () => {
		const interp = freshInterp();
		interp.defineGlobal(
			newSym("made"),
			interp.makeBuiltIn("made", 0, () => 1),
		);
		expect(() => snapshot(interp)).toThrow("made at run time");
	});

	it("rebuilds a foreign value through the extension that owns it", () => {
		class Handle {
			constructor(readonly id: string) {}
		}
		const codec = (interp: Interp): void => {
			interp.recovery.kind({
				name: "handle",
				claims: (x) => x instanceof Handle,
				save: (x) => (x as Handle).id,
				restore: (data) => new Handle(data as string),
			});
			interp.def(
				"handle-id",
				1,
				"(handle-id h)",
				"",
				z.tuple([z.instanceof(Handle)]),
				([h]) => h.id,
			);
		};
		const interp = freshInterp({ extensions: [codec] });
		interp.defineGlobal(newSym("h"), new Handle("h1"));
		const back = roundTrip(interp, { extensions: [codec] });
		expect(ev("(handle-id h)", back)).toBe('"h1"');
		expect(() => roundTrip(interp)).toThrow("no extension restores handle");
	});
});

describe("a promise in an image", () => {
	it("keeps a settled promise's outcome, and fails one still running", async () => {
		const interp = freshInterp();
		interp.defPromise("now", 0, "(now)", "", z.tuple([]), async () => 42n);
		interp.defPromise(
			"never",
			0,
			"(never)",
			"",
			z.tuple([]),
			() => new Promise(() => {}),
		);
		ev("(setq done (now) waiting (never))", interp);
		await (interp.getGlobal(newSym("done")) as LispPromise);
		const back = withSettle(roundTrip(interp));
		expect(await evAsync("(settle done)", back)).toBe("42");
		await expect(evAsync("(settle waiting)", back)).rejects.toThrow(
			"interrupted by restore",
		);
	});

	it("keeps a rejected promise's reason", async () => {
		const interp = freshInterp();
		interp.defPromise("boom", 0, "(boom)", "", z.tuple([]), async () => {
			throw new Error("it broke");
		});
		ev("(setq broken (boom))", interp);
		await (interp.getGlobal(newSym("broken")) as LispPromise).then(
			undefined,
			() => {},
		);
		const broken = roundTrip(interp).getGlobal(newSym("broken")) as LispPromise;
		await expect(broken.promise()).rejects.toThrow("it broke");
	});
});

describe("a sealed global", () => {
	function owned(): Interp {
		const interp = freshInterp();
		interp.defineGlobal(newSym("*ext/table*"), 1n);
		interp.seal(newSym("*ext/table*"), "ext");
		return interp;
	}

	it("refuses setq, defun and the doc and source writers", () => {
		const interp = owned();
		for (const form of [
			"(setq *ext/table* 2)",
			"(defun *ext/table* () 2)",
			'(_set-doc \'*ext/table* "(x)" "doc")',
			"(_set-source '*ext/table* '(x))",
		])
			expect(() => ev(form, interp)).toThrow("read-only global owned by ext");
		expect(ev("*ext/table*", interp)).toBe("1");
	});

	it("still takes writes from the extension, and shows in dump", () => {
		const interp = owned();
		interp.defineGlobal(newSym("*ext/table*"), 2n);
		expect(ev("*ext/table*", interp)).toBe("2");
		expect(ev("(member '*ext/table* (dump))", interp)).not.toBe("nil");
	});

	it("stays sealed across an image", () => {
		const back = roundTrip(owned());
		expect(() => ev("(setq *ext/table* 3)", back)).toThrow("read-only");
	});
});

describe("extension state", () => {
	const counter = {
		toLisp: (n: number) => BigInt(n),
		fromLisp: (x: unknown) => Number(x),
	};

	it("lives in a sealed global the extension reads back each time", () => {
		const interp = new Interp();
		const count = interp.state("ext/count", counter, 0, "How many.");
		count.set(count.get() + 2);
		expect(ev("*ext/count*", interp)).toBe("2");
		expect(() => ev("(setq *ext/count* 0)", interp)).toThrow("owned by ext");
		expect(interp.docs().get("*ext/count*")?.doc).toBe("How many.");
	});

	it("survives an image, read back from Lisp", () => {
		const declare = (interp: Interp) =>
			interp.state("ext/count", counter, 0, "");
		const interp = new Interp({ extensions: [(i) => declare(i).set(5)] });
		runSync(interp, "nil");
		const back = roundTrip(interp, {
			extensions: [(i) => void declare(i)],
		});
		expect(ev("*ext/count*", back)).toBe("5");
	});
});

describe("a value taken out of an image", () => {
	function carried(setup: string, name: string, into = freshInterp()): Interp {
		const from = freshInterp();
		ev(setup, from);
		into.defineGlobal(
			newSym(name),
			implant(into, extract(imageOf(from), name)),
		);
		return into;
	}

	it("carries nested data, and only what the global reaches", () => {
		const into = carried(
			'(setq other (list 9 9 9) rows (list (list :sku "a" :price 2.5)))',
			"rows",
		);
		expect(ev("(car rows)", into)).toBe('(:sku "a" :price 2.5)');
		expect(() => ev("other", into)).toThrow(/void variable/);
	});

	it("keeps a cycle and shared structure", () => {
		const into = carried(
			"(setq ring (list 1 2)) (setcdr (cdr ring) ring)",
			"ring",
		);
		expect(ev("(eq ring (cddr ring))", into)).toBe("t");
	});

	it("carries a closure with its frame, and resolves its globals where it lands", () => {
		const into = freshInterp();
		ev("(defun scale (x) (* x 100))", into);
		carried(
			"(defun scale (x) (* x 2)) (setq add (let ((n 5)) (lambda (x) (scale (+ x n)))))",
			"add",
			into,
		);
		expect(ev("(add 1)", into)).toBe("600");
	});

	it("leaves the interpreter it lands in untouched but for the value", () => {
		const into = freshInterp();
		ev("(setq xs 1)", into);
		carried("(setq xs 2 ys (list xs))", "ys", into);
		expect(ev("(list xs ys)", into)).toBe("(1 (2))");
	});

	it("refuses an unknown name and a promise still running", () => {
		const from = freshInterp();
		from.defPromise(
			"never",
			0,
			"(never)",
			"",
			z.tuple([]),
			() => new Promise(() => {}),
		);
		ev("(setq waiting (list (never)))", from);
		const image = imageOf(from);
		expect(() => extract(image, "missing")).toThrow("missing is not defined");
		expect(() => extract(image, "waiting")).toThrow("has not settled");
	});
});
