import { Interp } from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import { IDENTITY, MAX_STEPS, systemPromptFor } from "../src/prompts/lisp.ts";
import { snapshotConversation } from "../src/repl.ts";
import { agentExtensions } from "../src/repl-store.ts";

const PROMPT = systemPromptFor(new Interp({ extensions: agentExtensions() }));

const names = (name: string): RegExp => new RegExp(`\\b${name}\\b`);

describe("identity", () => {
	it("opens with the identity constant", () => {
		expect(PROMPT).toContain(IDENTITY);
	});
});

describe("prose around the forms", () => {
	it("says the text around the forms is skipped, not evaluated", () => {
		expect(PROMPT).toMatch(
			/only the parenthesised forms in it are program text/i,
		);
		expect(PROMPT).toMatch(/you may write a sentence around your code/i);
	});

	it("names the one character prose may not contain", () => {
		expect(PROMPT).toMatch(/prose may NOT contain/);
	});

	it("says a bare top-level value is prose rather than an expression", () => {
		expect(PROMPT).toMatch(
			/a bare value outside parentheses is prose, not code/i,
		);
	});

	it("says remarks belong in the prose, since there is no comment syntax", () => {
		expect(PROMPT).toMatch(/There are no comments/i);
		expect(PROMPT).toMatch(/Put any remark in the prose around the forms/i);
	});

	it("carries the language reference, which teaches the same rule", () => {
		expect(PROMPT).toMatch(
			/only the parenthesised top-level forms are program text/i,
		);
	});
});

describe("the failures a run actually dies of", () => {
	it("forbids wrapping a remark in parentheses, not just a lone paren", () => {
		expect(PROMPT).toMatch(/NEVER WRAP A REMARK IN PARENTHESES/);
		expect(PROMPT).toMatch(/NEVER PUT A SENTENCE IN PARENTHESES/);
	});

	it("says the aside tolerance is forgiveness, not a way to write", () => {
		expect(PROMPT).toMatch(
			/a mistake the reader forgives, NOT a way to write/i,
		);
		expect(PROMPT).toMatch(/narrow and unpredictable/i);
	});

	it("says a bare result name ends the turn instead of showing it", () => {
		expect(PROMPT).toMatch(/ENDS THE TURN/);
		expect(PROMPT).toMatch(/most expensive typo in the language/i);
	});

	it("says a discovery call prints itself and needs no echo", () => {
		expect(PROMPT).toMatch(/DISCOVERY CALLS PRINT THEMSELVES/);
		expect(PROMPT).toMatch(
			/never re-run the same search with different words/i,
		);
		for (const name of [
			"search-mcps",
			"search-tools",
			"list-tools",
			"list-toolkit",
			"list-mcps",
		])
			expect(PROMPT).toMatch(names(name));
	});

	it("points at doc for a tool's signature", () => {
		expect(PROMPT).toMatch(/prints (a tool's|a binding's|its) full signature/i);
	});

	it("says to stop when the request is met", () => {
		expect(PROMPT).toMatch(/Do what was asked, then stop/);
		expect(PROMPT).toMatch(/do not go on to snapshot it/i);
	});
});

describe("the REPL loop protocol", () => {
	it("says the REPL prints nothing and reports a name and shape instead", () => {
		expect(PROMPT).toMatch(/The REPL prints nothing on its own/);
		expect(PROMPT).toMatch(/name: shape/);
		expect(PROMPT).toMatch(/the ONE command that prints/);
	});

	it("describes the tool_result envelope results actually come back in", () => {
		expect(PROMPT).toContain('"type":"tool_result"');
		expect(PROMPT).toContain('"source":"lisp-repl"');
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
		expect(PROMPT).toContain('(identity "Standing by.")');
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
		expect(PROMPT).toContain(`after ${MAX_STEPS} steps`);
	});

	it("promises exactly the conversation globals the host injects", () => {
		for (const name of Object.keys(snapshotConversation([]))) {
			expect(PROMPT).toContain(`\`${name}\``);
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
			/load-mcp is asynchronous: it returns a promise immediately and does NOT block/,
		);
		expect(PROMPT).toMatch(
			/\(promise-state p\) checks progress \(:pending\/:fulfilled\/:rejected\)/,
		);
	});

	it("teaches the <server>/<tool> keyword calling convention", () => {
		expect(PROMPT).toMatch(
			/global named <server>\/<tool>, called with keyword args/,
		);
		expect(PROMPT).toMatch(/\(acme\/get_widget :id "42"\)/);
	});

	it.each([
		"playwright",
		"fs/",
		"linear",
		"posthog",
	])("names no real toolkit server in its examples (%s)", (name) => {
		expect(PROMPT).not.toContain(name);
	});

	it("says the server and tool names have to be discovered, not invented", () => {
		expect(PROMPT).toMatch(
			/You are not told which servers exist or what they are called/,
		);
		expect(PROMPT).toMatch(
			/Never invent a server or tool name — read it out of one of those results/,
		);
		expect(PROMPT).toMatch(
			/start from\s+search-mcps and let each step tell you the next name/,
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
		expect(PROMPT).toMatch(new RegExp(`There are NO[^.]*\\b${name}\\b`, "s"));
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
		expect(PROMPT).toMatch(/Quasiquote/);
	});

	it("tells the model to refer to the result variable, not retype data", () => {
		expect(PROMPT).toMatch(/NEVER retype data the REPL produced/);
		expect(PROMPT).toMatch(/name: shape/);
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
