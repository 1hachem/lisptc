import { LANGUAGE_REFERENCE } from "@repo/interpreter/source";
import { describe, expect, it } from "vitest";
import { LISP_SYSTEM_PROMPT } from "../src/index.ts";
import { IDENTITY, MAX_STEPS } from "../src/prompts/lisp.ts";
import { snapshotConversation } from "../src/repl.ts";

const names = (name: string): RegExp => new RegExp(`\\b${name}\\b`);

const PROMPT = LISP_SYSTEM_PROMPT.replace(/\s+/g, " ");

describe("assembly", () => {
	it("opens with the identity constant", () => {
		expect(LISP_SYSTEM_PROMPT).toContain(IDENTITY);
	});

	it("carries the language reference verbatim", () => {
		expect(LISP_SYSTEM_PROMPT).toContain(LANGUAGE_REFERENCE);
	});
});

describe("the REPL loop protocol", () => {
	it("says the text around the forms is skipped, not evaluated", () => {
		expect(PROMPT).toMatch(
			/only the parenthesised forms in it are program text/i,
		);
		expect(PROMPT).toMatch(/you may write a sentence around your code/i);
	});

	it("names the one character prose may not contain", () => {
		expect(PROMPT).toMatch(/prose may NOT contain/);
	});

	it("describes the tool_result envelope results actually come back in", () => {
		expect(LISP_SYSTEM_PROMPT).toContain('"type":"tool_result"');
		expect(LISP_SYSTEM_PROMPT).toContain('"source":"lisp-repl"');
		expect(PROMPT).toMatch(/Read `output`.*and `error`/s);
	});

	it("says the session is persistent, so earlier definitions survive", () => {
		expect(PROMPT).toMatch(/The REPL session is persistent/i);
	});

	it("teaches that form-less prose is what ends the loop", () => {
		expect(PROMPT).toMatch(/end the loop by replying with PROSE ALONE/);
		expect(PROMPT).toMatch(/there is no halt or exit built-in/i);
	});

	it("bans forms that only talk, while saying echoed output is read", () => {
		expect(PROMPT).toMatch(/The user READS everything the REPL echoes/);
		expect(PROMPT).toMatch(/What they cannot do is reply mid-loop/);
		expect(LISP_SYSTEM_PROMPT).toContain('(identity "Standing by.")');
		expect(PROMPT).toMatch(/Every form you write must do real work/i);
	});

	it("says a request needing no computation is answered in prose at once", () => {
		expect(PROMPT).toMatch(
			/Having nothing to compute is not a problem to be worked around/i,
		);
		expect(PROMPT).toMatch(/reply with prose alone on the FIRST turn/);
	});

	it("tells the model the loop is capped, and quotes the driver's cap", () => {
		expect(PROMPT).toMatch(/The loop also stops automatically/i);
		expect(LISP_SYSTEM_PROMPT).toContain(`after ${MAX_STEPS} steps`);
	});

	it("reserves thinking for prose and Lisp for the output", () => {
		expect(PROMPT).toMatch(/NEVER write Lisp in your thinking/);
	});

	it("promises exactly the conversation globals the host injects", () => {
		for (const name of Object.keys(snapshotConversation([]))) {
			expect(LISP_SYSTEM_PROMPT).toContain(`\`${name}\``);
		}
	});
});

describe("MCP", () => {
	const MCP_BUILTINS = [
		"load-mcp",
		"unload-mcp",
		"list-mcps",
		"list-toolkit",
		"list-tools",
		"search-tools",
		"search-mcps",
		"mcp-shutdown",
		"mcp-authorize",
		"login",
		"logout",
	];
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

	it.each([...MCP_BUILTINS, ...PROMISE_BUILTINS])("names %s", (name) => {
		expect(PROMPT).toMatch(names(name));
	});

	it("says load-mcp is async: it returns a promise and does not block", () => {
		expect(PROMPT).toMatch(
			/it returns a promise immediately and does NOT block/,
		);
		expect(PROMPT).toMatch(
			/`\(promise-state promise\)` checks `:pending` \/ `:fulfilled` \/ `:rejected` without waiting/,
		);
	});

	it("teaches the <server>/<tool> keyword calling convention", () => {
		expect(PROMPT).toMatch(
			/global named `<server>\/<tool>`, called with keyword args/,
		);
		expect(PROMPT).toMatch(/\(acme\/get_widget :id "42"\)/);
	});

	it.each([
		"playwright",
		"fs/",
		"linear",
		"posthog",
	])("names no real toolkit server in its examples (%s)", (name) => {
		expect(LISP_SYSTEM_PROMPT).not.toContain(name);
	});

	it("says the server and tool names have to be discovered, not invented", () => {
		expect(PROMPT).toMatch(
			/You are not told which servers exist or what they are called/,
		);
		expect(PROMPT).toMatch(
			/Never invent a server or tool name — read it out of one of those results/,
		);
		expect(PROMPT).toMatch(
			/start from `search-mcps` and let each step tell you the next name/,
		);
	});

	it("shows how to load a predefined server and an ad-hoc one", () => {
		expect(PROMPT).toMatch(/\(await \(load-mcp "acme"\)\)/);
		expect(PROMPT).toMatch(/:url "https:\/\/\.\.\."/);
		expect(PROMPT).toMatch(/:command "npx"/);
	});

	it("shows how to load several servers concurrently", () => {
		expect(PROMPT).toMatch(/promise-all-settled \(list \(load-mcp/);
	});
});

describe("the language reference", () => {
	const CORE_BUILTINS = [
		"car",
		"cdr",
		"cons",
		"list",
		"append",
		"mapcar",
		"assoc",
		"length",
		"concat",
		"print",
		"princ",
		"terpri",
		"doc",
		"secret",
		"secrets",
	];

	it.each(CORE_BUILTINS)("documents %s", (n) => {
		expect(PROMPT).toMatch(names(n));
	});

	it.each([
		"zerop",
		"evenp",
		"abs",
		"min",
		"max",
		"floor",
		"expt",
		"sqrt",
	])("warns that %s does not exist", (name) => {
		expect(PROMPT).toMatch(new RegExp(`There are NO[^.]*\`${name}\``, "s"));
	});

	it("states the closed-world rule outright", () => {
		expect(PROMPT).toMatch(
			/if a name is not listed there, it does not exist, so define it yourself/i,
		);
	});

	it("documents the special forms and reader sugar", () => {
		for (const form of ["defun", "defmacro", "lambda", "let", "cond", "try"]) {
			expect(PROMPT).toMatch(names(form));
		}
		expect(PROMPT).toMatch(/\*\*Quasiquote\*\*/);
	});
});

describe("interactive views", () => {
	it("says an action runs in the REPL with no model turn", () => {
		expect(PROMPT).toMatch(/runs IN THIS REPL/);
		expect(PROMPT).toMatch(/NO model turn in between/);
	});

	it("says the widget is not sent back into its context", () => {
		expect(PROMPT).toMatch(/the widget is never sent back to you/i);
	});

	it("names the render entry point and the constructors", () => {
		expect(PROMPT).toMatch(names("ui/render"));
		for (const tag of [
			"ui/stack",
			"ui/row",
			"ui/card",
			"ui/text",
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
		expect(PROMPT).toMatch(names("on-change"));
		expect(PROMPT).toMatch(/no submit button/);
	});

	it("draws the line between echoing and rendering", () => {
		expect(PROMPT).toMatch(
			/Echo when the answer is something to read; render when it is something to use/,
		);
	});

	it("says a handler can hand the turn back with ui/send", () => {
		expect(PROMPT).toMatch(names("ui/send"));
		expect(PROMPT).toMatch(/joins the conversation as a message from the user/);
	});

	it("says which clicks are worth a turn and which are not", () => {
		expect(PROMPT).toMatch(/Send for judgement, handle it in Lisp for work/);
	});
});
