import { readFileSync } from "node:fs";
import {
	STATUS_BAR_GAP_PREFIX,
	STATUS_BAR_GAPS,
	STATUS_BAR_ITEMS,
	STATUS_BAR_SLOT_COUNT,
} from "@repo/shared/status-bar";
import { describe, expect, it } from "vitest";

const prompt = readFileSync(
	new URL("../src/preferences.ptc", import.meta.url),
	"utf8",
).replace(/\s+/g, " ");

describe("the prompt's bottom bar", () => {
	it("states the slot count, the gap range and every item the app draws", () => {
		expect(prompt).toContain(`bottom bar's ${STATUS_BAR_SLOT_COUNT} slots`);
		expect(prompt).toContain(
			`"${STATUS_BAR_GAP_PREFIX}1" through "${STATUS_BAR_GAPS.at(-1)}"`,
		);
		for (const item of STATUS_BAR_ITEMS) expect(prompt).toContain(`"${item}"`);
	});
});
