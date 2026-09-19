import { arrayToList, newSym, str } from "@repo/interpreter";
import type { Memory } from "@repo/interpreter/memory";
import { describe, expect, it } from "vitest";
import { decodeMemory, encodeMemory } from "../src/memory-store.ts";

function roundTrip(memory: Memory): Memory {
	return decodeMemory(encodeMemory(memory));
}

const base: Memory = {
	key: "triage",
	body: "start with the logs",
	links: new Map([["logs", 2]]),
	score: 1.5,
	used: 3,
	lastUsed: 1_700_000_000_000,
};

describe("the memory codec", () => {
	it("carries prose, links and strength through the table", () => {
		expect(roundTrip(base)).toEqual(base);
	});

	it("carries a recipe back as a form, not as prose", () => {
		const body = arrayToList([newSym("defun"), newSym("triage"), 1]);
		const back = roundTrip({ ...base, body });
		expect(str(back.body)).toBe(str(body));
		expect(typeof back.body).not.toBe("string");
	});

	it("carries a trigger through the table", () => {
		const memory: Memory = {
			...base,
			on: { kind: "error", pattern: "timeout" },
		};
		expect(roundTrip(memory).on).toEqual({
			kind: "error",
			pattern: "timeout",
		});
	});

	it("leaves an untriggered memory untriggered", () => {
		expect(roundTrip(base).on).toBeUndefined();
	});
});
