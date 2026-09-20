import { systemPromptFor } from "@repo/ai";
import { Interp } from "@repo/interpreter/lisp";
import { TRIGGER_KINDS } from "@repo/memory-extension";
import { describe, expect, it } from "vitest";
import { modelFacing } from "./helpers.ts";

const PROMPT = systemPromptFor(new Interp({ extensions: modelFacing() }));

const names = (name: string): RegExp => new RegExp(`\\b${name}\\b`);

describe("the failures a run actually dies of", () => {
	it("forbids putting a sentence in parentheses", () => {
		expect(PROMPT).toMatch(/NEVER PUT A SENTENCE IN PARENTHESES/);
	});

	it("says the aside tolerance is forgiveness, not a way to write", () => {
		expect(PROMPT).toMatch(
			/a mistake the reader forgives, NOT a way to write/i,
		);
		expect(PROMPT).toMatch(/narrow and unpredictable/i);
	});

	it("says a bare result name is the most expensive typo there is", () => {
		expect(PROMPT).toMatch(/most expensive typo in the language/i);
	});

	it("says a discovery call prints itself and needs no echo", () => {
		expect(PROMPT).toMatch(/DISCOVERY CALLS PRINT THEMSELVES/);
		expect(PROMPT).toMatch(
			/never re-run the same search with different words/i,
		);
	});

	it("points at doc for a tool's signature", () => {
		expect(PROMPT).toMatch(/prints (a tool's|a binding's|its) full signature/i);
	});
});

describe("what the REPL reports back", () => {
	it("says the REPL prints nothing and reports a name and shape instead", () => {
		expect(PROMPT).toMatch(/The REPL prints nothing on its own/);
		expect(PROMPT).toMatch(/name: shape/);
		expect(PROMPT).toMatch(/the ONE command that prints/);
	});

	it("tells the model to refer to the result variable, not retype data", () => {
		expect(PROMPT).toMatch(/NEVER retype data the REPL produced/);
	});

	it("tells the model to extract into a name, then echo it", () => {
		expect(PROMPT).toMatch(/EXTRACT, THEN ECHO/);
		expect(PROMPT).toMatch(/RETURN a value/);
		expect(PROMPT).toMatch(/never read it off a printout and retype it/);
		expect(PROMPT).toMatch(names("grep"));
		expect(PROMPT).toMatch(names("echo"));
	});

	it("tells the model a truncated echo is not the whole output", () => {
		expect(PROMPT).toMatch(
			/Your view of echo output is capped; the user's is not/,
		);
		expect(PROMPT).toMatch(/page on with the offset/);
	});
});

describe("secrets", () => {
	it.each(["secret", "secrets"])("names %s", (name) => {
		expect(PROMPT).toMatch(names(name));
	});
});

describe("promises", () => {
	const PROMISE_BUILTINS = [
		"await",
		"promise-all",
		"promise-all-settled",
		"promise-any",
		"promise-race",
		"promise-state",
		"promises",
		"cancel",
	];

	it.each(PROMISE_BUILTINS)("names %s", (name) => {
		expect(PROMPT).toMatch(names(name));
	});
});

describe("memory", () => {
	const MEMORY_BUILTINS = [
		"memory/remember",
		"memory/recall",
		"memory/forget",
		"memory/revise",
		"memory/replay",
		"memories",
	];

	it.each(MEMORY_BUILTINS)("names %s", (name) => {
		expect(PROMPT).toContain(name);
	});

	it("names every trigger kind a memory can hook", () => {
		for (const kind of TRIGGER_KINDS) expect(PROMPT).toMatch(names(kind));
	});

	it("says a fired memory reaches the model and not the user", () => {
		expect(PROMPT).toMatch(/to you alone/);
		expect(PROMPT).toMatch(/the user does not see it/);
	});

	it("says why the memory builtins are slashed", () => {
		expect(PROMPT).toMatch(/ordinary English\s+verbs/);
	});

	it("says a code body has to be quoted", () => {
		expect(PROMPT).toMatch(/Quote a code body/);
	});

	it("shows the trigger the policy tells the agent to hook", () => {
		expect(PROMPT).toContain(`:on '(call (load-mcp "acme"))`);
	});
});

describe("interactive views", () => {
	const FLAT = PROMPT.replace(/\s+/g, " ");

	it("says an action runs in the REPL with no model turn", () => {
		expect(FLAT).toMatch(/runs IN THIS REPL/);
		expect(FLAT).toMatch(/NO model turn in between/);
	});

	it("says the widget is not sent back into its context", () => {
		expect(FLAT).toMatch(/the widget is never sent back to you/i);
	});

	it("names the render entry point and every constructor the renderer draws", () => {
		expect(PROMPT).toMatch(names("ui/render"));
		for (const tag of [
			"ui/stack",
			"ui/row",
			"ui/card",
			"ui/text",
			"ui/heading",
			"ui/markdown",
			"ui/kpi",
			"ui/badge",
			"ui/link",
			"ui/table",
			"ui/input",
			"ui/select",
			"ui/checkbox",
			"ui/button",
			"ui/form",
		])
			expect(PROMPT).toMatch(names(tag));
	});

	it("says a select or checkbox can act on change with no submit", () => {
		expect(FLAT).toMatch(names("on-change"));
		expect(FLAT).toMatch(/no submit button/);
	});

	it("draws the line between echoing and rendering", () => {
		expect(FLAT).toMatch(
			/Echo when the answer is something to read; render when it is something to use/,
		);
	});

	it("says a handler can hand the turn back with ui/send", () => {
		expect(FLAT).toMatch(names("ui/send"));
		expect(FLAT).toMatch(/joins the conversation as a message from the user/);
	});

	it("says which clicks are worth a turn and which are not", () => {
		expect(FLAT).toMatch(/Send for judgement, handle it in Lisp for work/);
	});

	it("names every tone the renderer can colour, and no others", () => {
		expect(FLAT).toMatch(/"ok", "warn", "bad", "info" or "muted"/);
		expect(FLAT).toMatch(/do not invent one/);
	});
});
