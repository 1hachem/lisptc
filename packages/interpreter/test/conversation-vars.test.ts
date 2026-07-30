import { describe, expect, it } from "vitest";
import { AgentRepl, MemoryRepl } from "../src/repl.ts";

// A small transcript mirroring what the pi extension snapshots each step.
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
	it("exposes messages as alists readable with assoc/car/cdr", () => {
		const r = new AgentRepl();
		r.setConversationVars(sampleVars());
		expect(r.eval('(cdr (assoc "role" (car conversation)))')).toBe('"user"\n');
		expect(r.eval('(cdr (assoc "content" (car conversation)))')).toBe('"hi"\n');
	});

	it("supports mapcar over a filtered message list", () => {
		const r = new AgentRepl();
		r.setConversationVars(sampleVars());
		expect(r.eval("(length user-messages)")).toBe("1\n");
		expect(r.eval("(car user-messages)")).toBe('"hi"\n');
		expect(
			r.eval('(mapcar (lambda (m) (cdr (assoc "role" m))) conversation)'),
		).toBe('("user" "assistant")\n');
	});

	it("re-injection restores a global the user reassigned (not hard read-only)", () => {
		const r = new AgentRepl();
		r.setConversationVars(sampleVars());
		expect(r.eval("(setq conversation 1)")).toBe("1\n");
		expect(r.eval("conversation")).toBe("1\n");
		// The extension calls setConversationVars before every eval; that refresh
		// overwrites the clobbered value.
		r.setConversationVars(sampleVars());
		expect(r.eval("(length conversation)")).toBe("2\n");
	});

	it("reset() keeps the injected globals (post-error survival)", () => {
		const r = new AgentRepl();
		r.setConversationVars(sampleVars());
		r.reset();
		expect(r.eval("(length conversation)")).toBe("2\n");
	});

	it("an empty snapshot yields nil lists", () => {
		const r = new AgentRepl();
		r.setConversationVars({ conversation: [], "user-messages": [] });
		expect(r.eval("conversation")).toBe("nil\n");
		expect(r.eval("(length user-messages)")).toBe("0\n");
	});
});

describe("MemoryRepl (language-only base)", () => {
	it("has no halt binding — halt is an AgentRepl feature", () => {
		const r = new MemoryRepl();
		// Unbound in function position reports "undefined: halt".
		expect(r.eval("(halt)")).toContain("undefined: halt");
	});
});
