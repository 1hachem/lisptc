import { describe, expect, it } from "vitest";
import { ASKS_KEY, type Ask, asking } from "../src/asks.ts";
import { noAnnotations } from "../src/session.ts";

const ask = (id: string): Ask => ({
	id,
	title: id,
	prompt: "needs you",
	choices: [
		{
			label: "Go",
			done: "Gone",
			accepts: true,
			answer: { action: "test/go", values: { id } },
		},
	],
});

describe("asking", () => {
	it("leaves the annotations alone when there is nothing to ask or answer", () => {
		const into = noAnnotations();
		expect(asking(into, {})).toBe(into);
	});

	it("merges what two extensions ask in one step under the one key", () => {
		const first = asking(noAnnotations(), { open: [ask("a")] });
		const both = asking(first, {
			open: [ask("b")],
			answered: { c: { accepted: false, label: "Denied" } },
		});
		expect(both.output[ASKS_KEY]).toEqual({
			open: [ask("a"), ask("b")],
			answered: { c: { accepted: false, label: "Denied" } },
		});
	});

	it("keeps what other keys the output lane already carries", () => {
		const into = { step: {}, output: { other: 1 } };
		expect(asking(into, { open: [ask("a")] }).output.other).toBe(1);
	});

	it("records only answers when nothing is asked", () => {
		const out = asking(noAnnotations(), {
			answered: { a: { accepted: true, label: "Gone" } },
		});
		expect(out.output[ASKS_KEY]).toEqual({
			answered: { a: { accepted: true, label: "Gone" } },
		});
	});

	it("keeps earlier answers when a later extension only asks", () => {
		const first = asking(noAnnotations(), {
			answered: { a: { accepted: true, label: "Gone" } },
		});
		const both = asking(first, { open: [ask("b")] });
		expect(both.output[ASKS_KEY]).toEqual({
			open: [ask("b")],
			answered: { a: { accepted: true, label: "Gone" } },
		});
	});
});
