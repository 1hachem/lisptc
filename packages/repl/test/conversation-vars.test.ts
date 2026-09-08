import { describe, expect, it } from "vitest";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

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

describe("AgentRepl conversation variables", () => {
	it("exposes messages as alists readable with assoc/car/cdr", async () => {
		const r = new AgentRepl();
		r.setConversationVars(sampleVars());
		expect(await r.eval('(cdr (assoc "role" (car conversation)))')).toBe(
			'cdr-1: "user"\n',
		);
		expect(await r.eval('(cdr (assoc "content" (car conversation)))')).toBe(
			'cdr-2: "hi"\n',
		);
	});

	it("supports mapcar over a filtered message list", async () => {
		const r = new AgentRepl();
		r.setConversationVars(sampleVars());
		expect(await r.eval("(length user-messages)")).toBe("length-1: 1\n");
		expect(await r.eval("(car user-messages)")).toBe('car-1: "hi"\n');
		expect(
			await r.eval('(mapcar (lambda (m) (cdr (assoc "role" m))) conversation)'),
		).toBe('mapcar-1: ("user" "assistant")\n');
	});

	it("re-injection restores a global the user reassigned (not hard read-only)", async () => {
		const r = new AgentRepl();
		r.setConversationVars(sampleVars());
		expect(await r.eval("(setq conversation 1)")).toBe("conversation: 1\n");
		expect(await r.eval("(progn conversation)")).toBe("progn-1: 1\n");
		r.setConversationVars(sampleVars());
		expect(await r.eval("(length conversation)")).toBe("length-1: 2\n");
	});

	it("reset() keeps the injected globals (post-error survival)", async () => {
		const r = new AgentRepl();
		r.setConversationVars(sampleVars());
		r.reset();
		expect(await r.eval("(length conversation)")).toBe("length-1: 2\n");
	});

	it("an empty snapshot yields nil lists", async () => {
		const r = new AgentRepl();
		r.setConversationVars({ conversation: [], "user-messages": [] });
		expect(await r.eval("(progn conversation)")).toBe("nil\n");
		expect(await r.eval("(length user-messages)")).toBe("length-1: 0\n");
	});
});

describe("MemoryRepl (language-only base)", () => {
	it("has no conversation globals — they are an AgentRepl feature", async () => {
		const r = new MemoryRepl();
		expect(await r.eval("(progn conversation)")).toContain("void variable");
	});
});
