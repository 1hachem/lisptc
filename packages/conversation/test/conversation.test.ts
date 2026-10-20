import {
	type ConversationEntry,
	conversationSlot,
} from "@repo/interpreter/conversation";
import { driveAsync, settled } from "@repo/interpreter/drive";
import { restore, snapshot } from "@repo/interpreter/image";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import {
	type AgentStep,
	type AgentTurn,
	type InterpExtension,
	openSession,
	type StepVerdict,
} from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import {
	conversationExtension,
	conversationVariables,
} from "../src/conversation.ts";
import {
	conversationHost,
	conversationHostFor,
} from "../src/conversation-host.ts";

const stored: ConversationEntry[] = [
	{ role: "user", content: "add one and two" },
	{ role: "assistant", content: "(echo (+ 1 2))" },
	{ role: "tool", content: "3" },
	{ role: "user", content: "now fix (car)" },
];

function session(extension: InterpExtension) {
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = openSession([extension]);
	const ctx = { interp, emit: () => {} };
	const turn = { interp } as AgentTurn;
	return {
		interp,
		hooks,
		read: (code: string) => str(runSync(interp, code), true),
		startTurn: () =>
			driveAsync(hooks.turnStart.run(() => settled(undefined), ctx)),
		beginStep: () =>
			driveAsync(hooks.beginStep.run(() => settled(undefined), ctx)),
		admit: (code: string, problems?: { line: number; message: string }[]) =>
			hooks.admit.run(
				async (_i, c) => ({
					code: c,
					...(problems ? { rejected: "not run", problems } : {}),
				}),
				interp,
				code,
			),
		endStep: (code: string, output: string, verdict: StepVerdict) =>
			hooks.stepEnd.run(
				(_t, _s, v) => v,
				turn,
				{
					step: 1,
					code,
					output,
					error: false,
					failed: false,
					latencyMs: 0,
				} as AgentStep,
				verdict,
			),
	};
}

function stopped() {
	return session(
		conversationExtension(conversationHostFor({ stored: async () => stored })),
	);
}

describe("the extension", () => {
	it("takes its prompt from the host", () => {
		expect(
			conversationExtension({ ...conversationHost, prompt: () => "supplied" })
				.prompt,
		).toBe("supplied");
	});

	it("promises in its prompt exactly the globals it defines", () => {
		const prompt = conversationExtension(conversationHost).prompt ?? "";
		for (const name of Object.keys(conversationVariables([])))
			expect(prompt).toContain(`\`${name}\``);
	});
});

describe("the conversation it keeps", () => {
	it("defines empty globals before any turn", () => {
		expect(stopped().read("conversation")).toBe("nil");
	});

	it("loads what was stored when a turn opens, and shows it before a step", async () => {
		const s = stopped();
		await s.startTurn();
		await s.beginStep();
		expect(s.read("(length conversation)")).toBe("4");
		expect(s.read("(car user-messages)")).toBe('"add one and two"');
		expect(s.read("assistant-messages")).toBe('("(echo (+ 1 2))")');
	});

	it("adds each step of the turn as it ends, with a stopped step's problems", async () => {
		const s = stopped();
		await s.startTurn();
		const problems = [{ line: 1, message: "car: expected 1 argument, got 0" }];
		await s.admit("(echo (car))", problems);
		s.endStep("(echo (car))", "not run", "continue");
		const entries = s.hooks.filled(conversationSlot)?.entries() ?? [];
		expect(entries.slice(4)).toEqual([
			{ role: "assistant", content: "(echo (car))" },
			{ role: "tool", content: "not run", problems },
		]);
		await s.beginStep();
		expect(s.read("(length conversation)")).toBe("6");
	});

	it("adds no tool message for the step that ends the turn", async () => {
		const s = stopped();
		await s.startTurn();
		await s.admit("the sum is 3");
		s.endStep("the sum is 3", "", "halt");
		const entries = s.hooks.filled(conversationSlot)?.entries() ?? [];
		expect(entries.at(-1)).toEqual({
			role: "assistant",
			content: "the sum is 3",
		});
	});

	it("drops the last turn's live steps once the next turn reloads the store", async () => {
		const s = stopped();
		await s.startTurn();
		await s.admit("(echo 1)");
		s.endStep("(echo 1)", "1", "continue");
		await s.startTurn();
		expect(s.hooks.filled(conversationSlot)?.entries()).toEqual(stored);
	});
});

describe("across an image", () => {
	it("keeps the globals the last step saw", async () => {
		const before = stopped();
		await before.startTurn();
		await before.beginStep();
		const after = stopped();
		restore(after.interp, snapshot(before.interp));
		expect(after.read("(length conversation)")).toBe("4");
		expect(after.read("(car user-messages)")).toBe('"add one and two"');
	});

	it("lets a setq on them stand only until the next step", async () => {
		const before = stopped();
		await before.startTurn();
		await before.beginStep();
		before.read("(setq user-messages nil)");
		const after = stopped();
		restore(after.interp, snapshot(before.interp));
		expect(after.read("user-messages")).toBe("nil");
		await after.startTurn();
		await after.beginStep();
		expect(after.read("(car user-messages)")).toBe('"add one and two"');
	});
});
