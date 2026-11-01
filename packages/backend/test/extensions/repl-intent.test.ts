import { intentExtension } from "@repo/intent-extension";
import { intentHost } from "@repo/intent-extension/host";
import {
	intentKey,
	questionKey,
	readAnnotation,
	viewKey,
} from "@repo/interpreter/annotations";
import { describe, expect, it } from "vitest";
import { agentRepl, modelFacing } from "./helpers.ts";

const withIntent = () =>
	agentRepl([...modelFacing(), intentExtension(intentHost)]);

describe("a step that says its intent", () => {
	it("carries the todo beside the view it rendered", async () => {
		const out = await withIntent().evalOutput(
			'(intent/todo "load" "show") (intent/check "load") (ui/render (ui/text "done"))',
		);
		expect(readAnnotation(out.annotations.output, intentKey)).toEqual({
			todos: [
				{ label: "load", done: true },
				{ label: "show", done: false },
			],
		});
		expect(readAnnotation(out.annotations.output, viewKey)).toEqual({
			viewId: "v1",
		});
		expect(out.effects).not.toContainEqual({ type: "end" });
	});

	it("ends the turn on a question and carries it", async () => {
		const out = await withIntent().evalOutput(
			'(intent/ask "Which board?" \'("Sales" "Support"))',
		);
		expect(out.effects).toContainEqual({ type: "end" });
		expect(readAnnotation(out.annotations.output, questionKey)).toEqual({
			id: "q1",
			prompt: "Which board?",
			choices: ["Sales", "Support"],
			multi: false,
		});
	});

	it("closes the last doing line as done, with how long it took, as the turn settles", async () => {
		const repl = withIntent();
		await repl.evalOutput('(intent/doing "look it up")');
		const settled = await repl.beforeSettle(false);
		const log = readAnnotation(settled.annotations.output, intentKey)?.log;
		expect(log).toEqual([
			{
				text: "look it up",
				startedAt: expect.any(Number),
				ms: expect.any(Number),
				state: "done",
			},
		]);
	});
});
