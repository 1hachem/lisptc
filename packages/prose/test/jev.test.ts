import {
	type Cell,
	type Interp,
	Reader,
	UnresolvedHead,
} from "@repo/interpreter/lisp";
import type { Ask, JevHost } from "@repo/jev/jev";
import type { SystemOneRequest } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { jevExcuse, jevSort } from "../src/jev.ts";
import type { ProseSpans } from "../src/prose.ts";

const ASIDE = "an aside about the program, not a call";
const PHRASE = "a phrase that reads as English";

function read(source: string): Cell {
	const reader = new Reader();
	reader.push(source);
	return reader.read() as Cell;
}

function failed(source: string): [Cell, UnresolvedHead] {
	const form = read(source);
	return [form, new UnresolvedHead("undefined", form, form.car)];
}

function spans(...list: string[]): ProseSpans {
	return { code: list.join("\n"), spans: list, bound: ["car", "echo"] };
}

function jev(
	answer: number | readonly number[] | Error,
	choice: string = ASIDE,
): { host: JevHost; asked: () => SystemOneRequest | undefined } {
	const nouls = typeof answer === "number" ? [answer] : answer;
	let asked: SystemOneRequest | undefined;
	const ask = ((request: SystemOneRequest) => {
		asked = request;
		if (answer instanceof Error) throw answer;
		const answers: Record<string, unknown> = {};
		for (const name of Object.keys(request.questions)) {
			const at = Number(name.replace(/^\D+/, "") || 0);
			answers[name] = name.startsWith("prose")
				? { type: "noul", noul: (nouls as readonly number[])[at] }
				: { type: "choice", choice, confidence: 1, probabilities: {} };
		}
		return Promise.resolve({
			model: "typesafe/jev-1.13",
			usage: { input_tokens: 1, output_tokens: 1 },
			answers,
		});
	}) as Ask;
	return { host: { ask }, asked: () => asked };
}

const noInterp = undefined as unknown as Interp;

describe("jevSort", () => {
	it("sorts a step's unsure spans into prose and code in one request", async () => {
		const fake = jev([0.9, 0.2], PHRASE);

		const sensed = await jevSort(fake.host)(
			spans("(see below)", "(fetch-rows db)"),
		);

		expect(sensed.get("(see below)")).toBe(PHRASE);
		expect(sensed.get("(fetch-rows db)")).toBe(false);
		expect(fake.asked()?.questions).toHaveProperty("prose1");
	});

	it("carries the whole step and the names in scope as state", async () => {
		const fake = jev([0.9]);

		await jevSort(fake.host)(spans("(see below)"));

		expect(fake.asked()?.state).toEqual({
			program: "(see below)",
			bound: ["car", "echo"],
		});
	});

	it("asks about at most eight spans in one step", async () => {
		const fake = jev(Array(12).fill(0.9));

		const sensed = await jevSort(fake.host)(
			spans(...Array.from({ length: 12 }, (_, i) => `(span-${i})`)),
		);

		expect(sensed.size).toBe(8);
		expect(sensed.has("(span-8)")).toBe(false);
	});

	it("senses nothing when the model cannot be reached", async () => {
		const sensed = await jevSort(jev(new Error("fetch failed")).host)(
			spans("(see below)"),
		);

		expect(sensed.size).toBe(0);
	});
});

describe("jevExcuse", () => {
	it("reads a likely aside as prose", async () => {
		const [form, error] = failed("(see below)");
		const excuse = jevExcuse(jev(0.95).host);

		expect(await excuse(noInterp, form, error)).toBe(
			`(see below) — ${ASIDE}, so this was read as prose`,
		);
	});

	it("excuses at the threshold and not below it", async () => {
		const [form, error] = failed("(fetch-rows db)");

		expect(await jevExcuse(jev(0.5).host)(noInterp, form, error)).toBeDefined();
		expect(
			await jevExcuse(jev(0.49).host)(noInterp, form, error),
		).toBeUndefined();
	});

	it.each([
		["(see below)", 0.76, true],
		["(one, two, three)", 0.55, true],
		["(fetch the rows from the database)", 0.54, true],
		["(now add the totals)", 0.74, true],
		["(TODO handle the empty case)", 0.63, true],
		["(the answer is 42)", 0.76, true],
		["(sheets/read-range :id 3)", 0.25, false],
		['(reverse-string "hello")', 0.24, false],
		["(helper-i-forgot-to-define 3)", 0.23, false],
	])("splits %s, answered %d, into prose: %s", async (source, noul, prose) => {
		const [form, error] = failed(source);
		const excuse = jevExcuse(jev(noul).host);

		expect((await excuse(noInterp, form, error)) !== undefined).toBe(prose);
	});

	it("carries the span and the failure as state", async () => {
		const [form, error] = failed("(one, two, three)");
		const fake = jev(0.9);

		await jevExcuse(fake.host)(noInterp, form, error);

		expect(fake.asked()?.state).toEqual({
			span: "(one, two, three)",
			failure: "undefined: one,",
		});
		expect(Object.keys(fake.asked()?.questions ?? {})).toEqual([
			"prose",
			"why",
		]);
	});

	it("gives no excuse when the model cannot be reached", async () => {
		const [form, error] = failed("(see below)");
		const excuse = jevExcuse(jev(new Error("fetch failed")).host);

		expect(await excuse(noInterp, form, error)).toBeUndefined();
	});
});
