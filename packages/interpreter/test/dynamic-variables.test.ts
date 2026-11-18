import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Hold } from "../src/drive.ts";
import { type Interp, runAsync } from "../src/lisp.ts";
import { str } from "../src/print.ts";
import { ev, freshInterp, roundTrip } from "./helpers.ts";

const WALK = `
(defvar *depth* 0)
(defun depth () *depth*)
(defun walk (n)
  (if (= n 0)
      nil
    (let ((*depth* (+ *depth* 1)))
      (cons (depth) (walk (- n 1))))))`;

describe("dynamic variables", () => {
	it("rebinds a defvar for every call made inside let", () => {
		expect(ev(`${WALK} (list (walk 3) *depth*)`)).toBe("((1 2 3) 0)");
	});

	it("restores the value when the body raises", () => {
		expect(
			ev(
				`${WALK} (try (let ((*depth* 5)) (error "boom")) (catch (e) *depth*))`,
			),
		).toBe("0");
	});

	it("lets setq inside the body change only the binding", () => {
		expect(
			ev(`${WALK} (list (let ((*depth* 1)) (setq *depth* 2) (depth)) *depth*)`),
		).toBe("(2 0)");
	});

	it("keeps a value defvar finds already set", () => {
		expect(ev("(setq *limit* 3) (defvar *limit* 10) *limit*")).toBe("3");
		expect(ev("(defvar *limit* 10) *limit*")).toBe("10");
	});

	it("leaves a let of an undeclared name lexical", () => {
		expect(
			ev("(setq *plain* 0) (defun peek () *plain*) (let ((*plain* 1)) (peek))"),
		).toBe("0");
	});

	it("keeps the declaration across an image round trip", () => {
		const interp = freshInterp();
		ev(WALK, interp);
		expect(ev("(walk 2)", roundTrip(interp))).toBe("(1 2)");
	});
});

describe("dynamic variables across a held step", () => {
	function parkingInterp(): { interp: Interp; held: () => Hold } {
		let hold: Hold | undefined;
		const interp = freshInterp({
			extensions: [
				(i: Interp) =>
					i.def("wait-here", 0, "(wait-here)", "Park.", z.tuple([]), () => {
						hold = i.hold("waiting");
						return hold?.until;
					}),
			],
		});
		ev(WALK, interp);
		interp.holds.parkable = true;
		return {
			interp,
			held: () => {
				if (hold === undefined) throw new Error("nothing parked");
				return hold;
			},
		};
	}

	it("hides a parked step's bindings from other steps and restores them on resume", async () => {
		const { interp, held } = parkingInterp();
		const parked = runAsync(interp, "(let ((*depth* 5)) (wait-here) (depth))");
		await Promise.resolve();
		expect(ev("(depth)", interp)).toBe("0");
		held().release();
		held().resume();
		const outcome = await parked;
		expect(str(outcome.value)).toBe("5");
		expect(ev("*depth*", interp)).toBe("0");
	});

	it("leaves the globals clean when a parked step is never resumed", async () => {
		const { interp } = parkingInterp();
		void runAsync(interp, "(let ((*depth* 5)) (wait-here))");
		await Promise.resolve();
		expect(ev("(list *depth* (walk 1))", interp)).toBe("(0 (1))");
	});
});
