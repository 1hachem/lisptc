import type { Said } from "@repo/interpreter/conversation";
import { describe, expect, it } from "vitest";
import { agentRepl, memoryRepl } from "./helpers.ts";

const sample: Said[] = [
	{ role: "user", content: "hi" },
	{ role: "assistant", content: "(+ 1 2)" },
];

const echoed = async (code: string, said = sample): Promise<string> => {
	const r = agentRepl();
	r.seed(said);
	return (await r.evalOutput(code)).user;
};

describe("AgentRepl conversation variables", () => {
	it("exposes messages as alists readable with assoc/car/cdr", async () => {
		expect(await echoed('(echo (cdr (assoc "role" (car conversation))))')).toBe(
			"user\n",
		);
		expect(
			await echoed('(echo (cdr (assoc "content" (car conversation))))'),
		).toBe("hi\n");
	});

	it("supports mapcar over a filtered message list", async () => {
		expect(await echoed("(echo (length user-messages))")).toBe("1\n");
		expect(await echoed("(echo (car user-messages))")).toBe("hi\n");
		expect(
			await echoed(
				'(echo (mapcar (lambda (m) (cdr (assoc "role" m))) conversation))',
			),
		).toBe('("user" "assistant")\n');
	});

	it("refuses to let code reassign a conversation global", async () => {
		const r = agentRepl();
		r.seed(sample);
		const out = await r.evalOutput("(setq conversation 1)");
		expect(out.failed).toBe(true);
		expect(out.user).toContain("read-only global owned by conversation");
		expect((await r.evalOutput("(echo (length conversation))")).user).toBe(
			"2\n",
		);
	});

	it("reset() keeps the seeded conversation (post-error survival)", async () => {
		const r = agentRepl();
		r.seed(sample);
		r.reset();
		expect((await r.evalOutput("(echo (length conversation))")).user).toBe(
			"2\n",
		);
	});

	it("an empty conversation yields nil lists", async () => {
		expect(await echoed("(echo (length conversation))", [])).toBe("0\n");
		expect(await echoed("(echo (length user-messages))", [])).toBe("0\n");
	});

	it("shows a note an extension appended, with its source, and hands it over once", async () => {
		const r = agentRepl();
		r.seed(sample);
		r.interp.conversation.append("memory", "k: v");

		expect(
			(
				await r.evalOutput(
					'(echo (cdr (assoc "source" (car (last conversation)))))',
				)
			).user,
		).toBe("memory\n");
		expect((await r.evalOutput("(echo (length user-messages))")).user).toBe(
			"1\n",
		);
		expect((await r.beginStep()).notes).toEqual([]);
	});
});

describe("MemoryRepl", () => {
	it("starts with an empty conversation", async () => {
		const r = memoryRepl();
		expect((await r.evalOutput("(echo (length conversation))")).user).toBe(
			"0\n",
		);
	});
});
