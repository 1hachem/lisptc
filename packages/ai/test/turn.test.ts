import { AgentRepl } from "@repo/repl/repl";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDelta, AgentMessage } from "../src/agent.ts";
import type { TranscriptEntry } from "../src/repl.ts";
import type { TurnEvent } from "../src/turn.ts";

interface Seen {
	messages: AgentMessage[];
}

const seen: Seen[] = [];
let script: AgentDelta[][] = [];
let throws: string | undefined;
let calls = 0;

vi.mock("../src/agent.ts", () => ({
	streamAgent: async function* (messages: AgentMessage[]) {
		seen.push({ messages });
		if (throws) throw new Error(throws);
		const turn = script[Math.min(calls++, script.length - 1)];
		for (const delta of turn) yield delta;
	},
}));

class CountingRepl extends AgentRepl {
	evals = 0;

	override async evalOutput(code: string) {
		this.evals += 1;
		return super.evalOutput(code);
	}
}

describe("the agent turn", () => {
	let runAgentTurn: typeof import("../src/turn.ts").runAgentTurn;

	beforeAll(async () => {
		({ runAgentTurn } = await import("../src/turn.ts"));
	});

	beforeEach(() => {
		seen.length = 0;
		script = [];
		throws = undefined;
		calls = 0;
	});

	async function drain(
		transcript: TranscriptEntry[],
		options?: Parameters<typeof runAgentTurn>[1],
	): Promise<TurnEvent[]> {
		const events: TurnEvent[] = [];
		for await (const event of runAgentTurn(transcript, options))
			events.push(event);
		return events;
	}

	const ask: TranscriptEntry[] = [{ role: "user", content: "what is 1 + 2?" }];

	test("a prose reply ends the loop and reports the answer", async () => {
		script = [[{ text: "(+ 1 2)" }], [{ text: "three." }]];

		const events = await drain(ask);

		expect(events.map((e) => e.type)).toEqual([
			"delta",
			"assistant",
			"result",
			"delta",
			"assistant",
			"halt",
		]);
		expect(events.at(-1)).toMatchObject({ answer: "three.", steps: 2 });
	});

	test("the loop stops at maxSteps without an answer", async () => {
		script = [[{ text: "(+ 1 2)" }]];

		const events = await drain(ask, { maxSteps: 2 });

		expect(events.filter((e) => e.type === "result")).toHaveLength(2);
		expect(events.at(-1)).toEqual({ type: "capped", steps: 2 });
	});

	test("a failed model call is reported, not thrown", async () => {
		throws = "upstream exploded";

		const events = await drain(ask);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "failed",
			message: "upstream exploded",
		});
	});

	test("withheld prose feedback reaches the model, and the caller's transcript is untouched", async () => {
		const repl = new AgentRepl();
		await repl.evalOutput("all done (see above)");
		repl.takeFinished();
		script = [[{ text: "three." }]];

		await drain(ask, { repl });

		const sent = seen[0].messages;
		expect(sent.at(-1)?.content).toContain("your previous reply ran nothing");
		expect(sent.at(-1)?.content).toContain("(see above)");
		expect(ask).toHaveLength(1);
	});

	test("a consumer that stops consuming stops the loop", async () => {
		const repl = new CountingRepl();
		script = [[{ text: "(+ 1 2)" }]];

		for await (const event of runAgentTurn(ask, { repl })) {
			if (event.type === "delta") break;
		}

		expect(repl.evals).toBe(0);
		expect(seen).toHaveLength(1);
	});
});
