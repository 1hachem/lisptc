import { intentExtension } from "@repo/intent-extension";
import { intentHost } from "@repo/intent-extension/host";
import { Interp } from "@repo/interpreter/lisp";
import { TRIGGER_KINDS } from "@repo/memory-extension/ports";
import { describe, expect, it } from "vitest";
import { modelFacing } from "./helpers.ts";

const PROMPT = new Interp({ extensions: modelFacing() }).systemPrompt();

const names = (name: string): RegExp => new RegExp(`\\b${name}\\b`);

describe("the failures a run actually dies of", () => {
	it("says the aside tolerance is forgiveness, not a way to write", () => {
		expect(PROMPT).toMatch(/Mistake the reader\s+forgave, not a way to write/i);
		expect(PROMPT).toMatch(/Forgiveness narrow, unpredictable/i);
	});

	it("says a discovery call prints itself and needs no echo", () => {
		expect(PROMPT).toMatch(/DISCOVERY CALLS PRINT THEMSELVES/);
		expect(PROMPT).toMatch(
			/never re-run the same search with different words/i,
		);
	});

	it("points at doc for a binding's signature", () => {
		expect(PROMPT).toMatch(/prints (a tool's|a binding's|its) full signature/i);
	});
});

describe("what the REPL reports back", () => {
	it("says the REPL prints nothing and reports a name and shape instead", () => {
		expect(PROMPT).toMatch(/REPL prints nothing on its own/);
		expect(PROMPT).toMatch(/name: shape/);
		expect(PROMPT).toMatch(/echo is the one command that shows a value/);
	});

	it("tells the model to refer to the result variable, not retype data", () => {
		expect(PROMPT).toMatch(/Never retype data the REPL produced/);
	});

	it("tells the model to extract into a name, then echo it", () => {
		expect(PROMPT).toMatch(/EXTRACT, THEN ECHO/);
		expect(PROMPT).toMatch(/RETURN a value/);
		expect(PROMPT).toMatch(/Never read a value off a printout and retype it/);
		expect(PROMPT).toMatch(names("grep"));
		expect(PROMPT).toMatch(names("echo"));
	});

	it("tells the model a truncated echo is not the whole output", () => {
		expect(PROMPT).toMatch(/Echo output is capped for you, not for the user/);
		expect(PROMPT).toMatch(/Page on with the given offset/);
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
		"memory/forget-all",
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
		expect(PROMPT).toMatch(/user does\s+not see it/);
	});

	it("says why the memory builtins are slashed", () => {
		expect(PROMPT).toMatch(/are English verbs and would\s+be read as code/);
	});

	it("says a code body has to be quoted", () => {
		expect(PROMPT).toMatch(/Quote it: arguments are\s+evaluated/);
	});
});

describe("interactive views", () => {
	const FLAT = PROMPT.replace(/\s+/g, " ");

	it("says an action runs in the REPL with no model turn", () => {
		expect(FLAT).toMatch(/runs IN THIS REPL/);
		expect(FLAT).toMatch(/NO model turn between/);
	});

	it("says the widget is not sent back into its context", () => {
		expect(FLAT).toMatch(/widget is never sent back/i);
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
		expect(FLAT).toMatch(/No submit, no model turn/);
	});

	it("says the user never sees text output, so what they read is rendered", () => {
		expect(FLAT).toMatch(/User sees no text output: echo is for you alone/);
		expect(FLAT).toMatch(/User never sees text output: put what they should/);
		expect(FLAT).toContain("(ui/render (ui/table issues-1))");
	});

	it("names the forms that open a file or a view beside the chat", () => {
		expect(PROMPT).toMatch(names("ui/open-file"));
		expect(PROMPT).toMatch(names("ui/open-view"));
	});

	it("says a handler can hand the turn back with ui/send", () => {
		expect(FLAT).toMatch(names("ui/send"));
		expect(FLAT).toMatch(/result joins conversation as user message/);
	});

	it("says which clicks are worth a turn and which are not", () => {
		expect(FLAT).toMatch(/Send for judgement, handle in Lisp for work/);
	});

	it("names every tone the renderer can colour, and no others", () => {
		expect(FLAT).toMatch(/"ok", "warn", "bad", "info" or "muted"/);
		expect(FLAT).toMatch(/do not invent one/);
	});
});

describe("what reaches the user", () => {
	const FLAT = new Interp({
		extensions: [...modelFacing(), intentExtension(intentHost)],
	})
		.systemPrompt()
		.replace(/\s+/g, " ");

	it("lists what the user sees, intent forms included", () => {
		expect(FLAT).toMatch(/User sees no code, no results, no text output/);
		for (const form of [
			"intent/doing",
			"intent/todo",
			"intent/check",
			"intent/progress",
			"intent/ask",
		])
			expect(FLAT).toMatch(names(form));
	});

	it("asks a closed choice with intent/ask rather than in prose", () => {
		expect(FLAT).toMatch(/Closed choice for user: intent\/ask/);
	});
});
