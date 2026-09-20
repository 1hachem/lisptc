import { type ProseSense, proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { describe, expect, it } from "vitest";
import { memoryRepl } from "./helpers.ts";

interface Asked {
	code: string;
	spans: string[];
	bound: string[];
}

function sorting(sensed: Record<string, ProseSense>): {
	extension: ReturnType<typeof proseExtension>;
	asked: () => Asked[];
} {
	const asked: Asked[] = [];
	const extension = proseExtension({
		...proseHost,
		sort: ({ code, spans, bound }) => {
			asked.push({ code, spans: [...spans], bound: [...bound] });
			return new Map(Object.entries(sensed));
		},
	});
	return { extension, asked: () => asked };
}

async function unrunIn(
	code: string,
	sensed: Record<string, ProseSense> = {},
): Promise<[number, number][]> {
	const r = memoryRepl([sorting(sensed).extension]);
	const { annotations } = await r.evalOutput(code);
	return annotations.output.unrun as [number, number][];
}

describe("reporting the spans a step did not run", () => {
	it("names no range when the step ran everything", async () => {
		expect(await unrunIn('(echo "hi") (car (list 1))')).toEqual([]);
	});

	it("names the range the rules read as prose", async () => {
		expect(await unrunIn('hello (see below) (echo "hi")')).toEqual([[6, 17]]);
	});

	it("names the range the host called prose, in source order", async () => {
		expect(
			await unrunIn('(deploy "a") ok (see below)', {
				'(deploy "a")': "read as English",
			}),
		).toEqual([
			[0, 12],
			[16, 27],
		]);
	});

	it("keeps a range the host called code out of the report", async () => {
		expect(await unrunIn("(see below)", { "(see below)": false })).toEqual([]);
	});

	it("names a span no reader could parse", async () => {
		expect(await unrunIn("and others (a deprecated `x`).")).toEqual([[11, 29]]);
	});

	it("reports each step on its own", async () => {
		const r = memoryRepl([sorting({}).extension]);

		await r.evalOutput("(see below)");
		const { annotations } = await r.evalOutput('(echo "hi")');

		expect(annotations.output.unrun).toEqual([]);
	});
});

describe("sorting a step's spans before it runs", () => {
	it("asks only about the spans no head in scope settles", async () => {
		const sorter = sorting({});
		const r = memoryRepl([sorter.extension]);

		await r.eval('(echo "hi") (see below) (car (list 1))');

		expect(sorter.asked()).toEqual([
			{
				code: '(echo "hi") (see below) (car (list 1))',
				spans: ["(see below)"],
				bound: ["echo", "car"],
			},
		]);
	});

	it("asks nothing of a step every head in scope settles", async () => {
		const sorter = sorting({});
		const r = memoryRepl([sorter.extension]);

		await r.eval('(echo "hi")');

		expect(sorter.asked()).toEqual([]);
	});

	it("runs a span the rules would have skipped when the host calls it code", async () => {
		const r = memoryRepl([sorting({ "(see below)": false }).extension]);

		expect(await r.eval("(see below)")).toMatch(/undefined: see/);
	});

	it("skips a span the rules would have run when the host calls it prose", async () => {
		const r = memoryRepl([
			sorting({ '(deploy "the thing")': "read as English" }).extension,
		]);

		expect(await r.eval('(deploy "the thing")')).toBe(
			"skipped read as English\n",
		);
	});

	it("leaves a span the host did not sense to the rules", async () => {
		const r = memoryRepl([sorting({ "(other thing)": false }).extension]);

		expect(await r.eval('(deploy "the thing")')).toMatch(/undefined: deploy/);
		expect(await r.eval("(see below)")).toBe(
			'skipped (see below) — "see" is not defined, so this was read as prose\n',
		);
	});
});
