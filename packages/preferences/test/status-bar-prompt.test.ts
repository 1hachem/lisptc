import { Interp, runSync } from "@repo/interpreter/lisp";
import { Cell, listToArray, newSym } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import {
	STATUS_BAR_GAPS,
	STATUS_BAR_ITEMS,
	STATUS_BAR_SLOT_COUNT,
} from "@repo/shared/status-bar";
import { describe, expect, it } from "vitest";
import { preferencesExtension } from "../src/preferences.ts";
import { preferencesHostFor } from "../src/preferences-host.ts";
import { HOST_CHOICES } from "./helpers.ts";

function memoryBodies(source: string): string {
	const interp = new Interp({
		extensions: [preferencesExtension(preferencesHostFor(HOST_CHOICES))],
	});
	runSync(interp, prelude);
	runSync(
		interp,
		`(setq bodies nil)
(defmacro memory (key &rest declared) \`(setq bodies (cons ,(car (last declared)) bodies)))
(defmacro area (name &rest declared) nil)`,
	);
	runSync(interp, source);
	const bodies = interp.getGlobal(newSym("bodies"));
	return (bodies instanceof Cell ? listToArray(bodies) : []).join("\n");
}

const prompt = memoryBodies(
	preferencesExtension(preferencesHostFor(HOST_CHOICES)).memories ?? "",
).replace(/\s+/g, " ");

describe("the memory's bottom bar", () => {
	it("states the slot count and every item and gap the app draws", () => {
		expect(prompt).toContain(`bottom bar's ${STATUS_BAR_SLOT_COUNT} slots`);
		for (const name of [...STATUS_BAR_ITEMS, ...STATUS_BAR_GAPS])
			expect(prompt).toContain(`"${name}"`);
	});
});
