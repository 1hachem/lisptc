import { describe, expect, test } from "vitest";
import { type KwargMessage, lighten } from "../src/messages.ts";

const prose = [{ span: [0, 3] as [number, number], reason: "prose" }];

const meta = { durationMs: 5, steps: 2 };

function ai(content: string): KwargMessage {
	return {
		type: "ai",
		content,
		additional_kwargs: { reasoning_content: "thinking", prose, meta },
	};
}

describe("a light transcript", () => {
	test("leaves what the person and the system said as it was", () => {
		const said: KwargMessage[] = [
			{ type: "human", content: "hi", additional_kwargs: { riding: "r" } },
			{
				type: "system",
				content: "an event",
				additional_kwargs: { source: "s" },
			},
		];

		expect(lighten(said)).toEqual(said);
	});

	test("keeps every step the model wrote and the thinking before it, so neither leaves its place", () => {
		const light = lighten([
			{ type: "human", content: "one" },
			ai("(+ 1 2)"),
			{ type: "tool", content: "3" },
			ai("three."),
		]);

		expect(light.filter((m) => m.type === "ai")).toEqual([
			ai("(+ 1 2)"),
			ai("three."),
		]);
	});

	test("keeps of a result what it draws and drops every text it printed", () => {
		const [result] = lighten([
			{
				type: "tool",
				content: '{"type":"tool_result","output":"3"}',
				additional_kwargs: {
					display: "3",
					failed: true,
					quiet: true,
					results: ["3"],
					riding: "a note for the model",
					ui: { tag: "text" },
					asks: [{ id: "a" }],
				},
			},
		]);

		expect(result).toEqual({
			type: "tool",
			content: "",
			additional_kwargs: {
				failed: true,
				quiet: true,
				ui: { tag: "text" },
				asks: [{ id: "a" }],
			},
		});
	});

	test("keeps the other fields of a message it lightens", () => {
		const [result] = lighten([
			{ type: "tool", content: "3", id: "t1", seq: 4 } as KwargMessage & {
				id: string;
				seq: number;
			},
		]);

		expect(result).toEqual({ type: "tool", content: "", id: "t1", seq: 4 });
	});

	test("drops a result's content when the person was shown nothing", () => {
		const content =
			'{"source":"lisp-repl","output":"((\\"playwright\\" 7 :unloaded))"}';
		const [shown] = lighten([
			{ type: "tool", content, additional_kwargs: { results: ["3"] } },
		]);

		expect(shown).toEqual({ type: "tool", content: "", additional_kwargs: {} });
	});

	test("drops an echo, which is for the agent alone", () => {
		const content = '{"source":"lisp-repl","output":"hello"}';
		const [shown] = lighten([
			{ type: "tool", content, additional_kwargs: { display: "hello" } },
		]);

		expect(shown).toEqual({ type: "tool", content: "", additional_kwargs: {} });
	});
});
