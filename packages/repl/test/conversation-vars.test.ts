import { describe, expect, it } from "vitest";
import { agentRepl, memoryRepl } from "./helpers.ts";

function sampleVars() {
	return {
		conversation: [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "(+ 1 2)" },
		],
		"user-messages": ["hi"],
		"assistant-messages": ["(+ 1 2)"],
	};
}

const echoed = async (code: string, vars = sampleVars()): Promise<string> => {
	const r = agentRepl();
	r.setConversationVars(vars);
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

	it("re-injection restores a global the user reassigned (not hard read-only)", async () => {
		const r = agentRepl();
		r.setConversationVars(sampleVars());
		await r.eval("(setq conversation 1)");
		expect((await r.evalOutput("(echo conversation)")).user).toBe("1\n");
		r.setConversationVars(sampleVars());
		expect((await r.evalOutput("(echo (length conversation))")).user).toBe(
			"2\n",
		);
	});

	it("reset() keeps the injected globals (post-error survival)", async () => {
		const r = agentRepl();
		r.setConversationVars(sampleVars());
		r.reset();
		expect((await r.evalOutput("(echo (length conversation))")).user).toBe(
			"2\n",
		);
	});

	it("an empty snapshot yields nil lists", async () => {
		const empty = {
			conversation: [],
			"user-messages": [],
			"assistant-messages": [],
		};
		expect(await echoed("(echo (length conversation))", empty)).toBe("0\n");
		expect(await echoed("(echo (length user-messages))", empty)).toBe("0\n");
	});
});

describe("MemoryRepl (language-only base)", () => {
	it("has no conversation globals — they are an AgentRepl feature", async () => {
		const r = memoryRepl();
		expect(await r.eval("(progn conversation)")).toContain("void variable");
	});
});
