import { describe, expect, it } from "vitest";
import { LISP_SYSTEM_PROMPT } from "../src/index.ts";
import { IDENTITY, MAX_STEPS } from "../src/prompts/lisp.ts";
import { snapshotConversation } from "../src/repl.ts";

// The system prompt is the whole contract between the model and this REPL: it
// is the only tool description, API reference and protocol spec the model gets.
// Asserted through the package's public export, since that is what apps/api
// hands the model.

// The prompt writes a built-in as bare prose (`load-mcp`) or inside a call
// (`(car x)`), so match the name itself rather than any one of those shapes.
const names = (name: string): RegExp => new RegExp(`\\b${name}\\b`);

describe("identity", () => {
	it("opens with the identity constant", () => {
		expect(LISP_SYSTEM_PROMPT).toContain(IDENTITY);
	});
});

describe("prose around the forms", () => {
	// Without these rules the model falls back on Common Lisp habits it was
	// trained on — `;` comments and bare top-level atoms — both of which this
	// dialect reads as something else entirely.
	it("says the text around the forms is skipped, not evaluated", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/only the parenthesised forms in it are program text/i,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/you may write a sentence around your code/i,
		);
	});

	it("names the one character prose may not contain", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/prose may NOT contain/);
	});

	it("says a bare top-level value is prose rather than an expression", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/a bare value outside parentheses is prose, not code/i,
		);
	});

	it("says remarks belong in the prose, since there is no comment syntax", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/There are no comments/i);
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/Put any remark in the prose around the forms/i,
		);
	});

	it("carries the language reference, which teaches the same rule", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/only the parenthesised top-level forms are program text/i,
		);
	});
});

describe("the REPL loop protocol", () => {
	// The silent REPL is the rule the model cannot guess: without it, it waits
	// for values that are never printed and answers from what it never saw.
	it("says the REPL prints nothing and reports a name and shape instead", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/The REPL prints nothing on its own/);
		expect(LISP_SYSTEM_PROMPT).toMatch(/`name: shape`/);
		expect(LISP_SYSTEM_PROMPT).toMatch(/the ONE command that prints/);
	});

	it("describes the tool_result envelope results actually come back in", () => {
		expect(LISP_SYSTEM_PROMPT).toContain('"type":"tool_result"');
		expect(LISP_SYSTEM_PROMPT).toContain('"source":"lisp-repl"');
		expect(LISP_SYSTEM_PROMPT).toMatch(/Read `output`.*and `error`/s);
	});

	it("says the session is persistent, so earlier definitions survive", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/The REPL session is persistent/i);
	});

	it("teaches that form-less prose is what ends the loop", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/end the loop by replying with PROSE ALONE/,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(/there is no halt or exit built-in/i);
	});

	// Left to rule 4b alone the model treats stopping as failure and stalls the
	// loop with no-op forms (`(identity "Standing by.")`), burning every step up
	// to the cap. The distinction that has to be exact: the user DOES read what
	// a step echoes (rendering is real work), they just cannot answer mid-loop.
	it("bans forms that only talk, while saying echoed output is read", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/The user READS everything the REPL echoes/,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(/What they cannot do is reply mid-loop/);
		expect(LISP_SYSTEM_PROMPT).toContain('(identity "Standing by.")');
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/Every form you write must do real work/i,
		);
	});

	it("says a request needing no computation is answered in prose at once", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/Having nothing to compute is not a problem to be worked around/i,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/reply with prose alone on the FIRST turn/,
		);
	});

	// The cap is the model's other exit besides a form-less reply, so it has to know the
	// loop is bounded at all — that first assertion is the one that bites. The
	// second only guards the coupling: the policy interpolates the same
	// `MAX_STEPS` that stream.ts breaks on, so it cannot fail today, but it
	// would if someone replaced that interpolation with a literal number.
	it("tells the model the loop is capped, and quotes the driver's cap", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/The loop also stops automatically/i);
		expect(LISP_SYSTEM_PROMPT).toContain(`after ${MAX_STEPS} steps`);
	});

	it("promises exactly the conversation globals the host injects", () => {
		for (const name of Object.keys(snapshotConversation([]))) {
			expect(LISP_SYSTEM_PROMPT).toContain(`\`${name}\``);
		}
	});
});

describe("MCP", () => {
	// Every MCP built-in the model is expected to reach for. The prompt is its
	// only API reference, so a built-in missing from here is one it never calls.
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
	const JOB_BUILTINS = [
		"await",
		"await-all",
		"await-any",
		"job-status",
		"jobs",
		"cancel",
	];

	it.each([...MCP_BUILTINS, ...JOB_BUILTINS])("names %s", (name) => {
		expect(LISP_SYSTEM_PROMPT).toMatch(names(name));
	});

	it("says load-mcp is async: it returns a job and does not block", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/`load-mcp` is asynchronous: it returns a job immediately and does NOT block/,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/`\(job-status job\)` checks progress \(:pending\/:done\/:error\)/,
		);
	});

	it("teaches the <server>/<tool> keyword calling convention", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/global named `<server>\/<tool>`, called with keyword args/,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(/\(acme\/get_widget :id "42"\)/);
	});

	// Every server and tool the examples name is invented. A real one (the
	// toolkit ships `playwright`, `fs`, `linear`, `posthog`) would hand the model
	// an answer it is supposed to reach by searching — and would quietly turn the
	// navigate eval into a test of whether it can copy the prompt.
	it.each([
		"playwright",
		"fs/",
		"linear",
		"posthog",
	])("names no real toolkit server in its examples (%s)", (name) => {
		expect(LISP_SYSTEM_PROMPT).not.toContain(name);
	});

	it("says the server and tool names have to be discovered, not invented", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/You are not told which servers exist or what they are called/,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/Never invent a server or tool name — read it out of one of those results/,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/start from\s+`search-mcps` and let each step tell you the next name/,
		);
	});

	it("shows how to load a predefined server and an ad-hoc one", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/\(await \(load-mcp "acme"\)\)/);
		expect(LISP_SYSTEM_PROMPT).toMatch(/:url "https:\/\/\.\.\."/);
		expect(LISP_SYSTEM_PROMPT).toMatch(/:command "npx"/);
	});

	it("shows how to load several servers concurrently", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/await-all \(list \(load-mcp/);
	});
});

describe("the language reference", () => {
	// The reference is a closed world: "if a name is not listed there, it does
	// not exist", so it has to name both what exists and what pointedly does not.
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
		expect(LISP_SYSTEM_PROMPT).toMatch(names(n));
	});

	// Named in the reference only to say they are absent, so the model builds
	// them itself instead of calling one and getting `undefined: expt`.
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
		expect(LISP_SYSTEM_PROMPT).toMatch(
			new RegExp(`There are NO[^.]*\`${name}\``, "s"),
		);
	});

	it("states the closed-world rule outright", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/if a name is not listed there, it does not exist, so define it yourself/i,
		);
	});

	it("documents the special forms and reader sugar", () => {
		for (const form of ["defun", "defmacro", "lambda", "let", "cond", "try"]) {
			expect(LISP_SYSTEM_PROMPT).toMatch(names(form));
		}
		expect(LISP_SYSTEM_PROMPT).toMatch(/\*\*Quasiquote\*\*/);
	});

	// Truncation is a REPL behaviour, not a language feature, so the closed-world
	// rule above does not cover it — POLICY has to say it outright or the model
	// reads a `...` line as the end of the value.
	it("tells the model to refer to the result variable, not retype data", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/NEVER retype data the REPL produced/);
		expect(LISP_SYSTEM_PROMPT).toMatch(/`name: shape`/);
	});

	// The two moves that make retyping unnecessary. Naming the failure it
	// replaces ("read it off a printout") is the part that has to survive.
	it("tells the model to extract into a name, then echo it", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/EXTRACT, THEN ECHO/);
		expect(LISP_SYSTEM_PROMPT).toMatch(/RETURN a value/);
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/never read it off a printout and retype it/,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(names("grep"));
		expect(LISP_SYSTEM_PROMPT).toMatch(names("echo"));
	});

	it("tells the model a truncated echo is not the whole output", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/Your view of echo output is capped; the user's is not/,
		);
		expect(LISP_SYSTEM_PROMPT).toMatch(/page on with the offset/);
	});
});

describe("interactive views", () => {
	// A view is the one thing the model can build that keeps paying after the
	// turn ends, so the prompt has to say both halves: that a handler runs
	// without a model turn, and that the widget never comes back to it.
	it("says an action runs in the REPL with no model turn", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/runs IN THIS REPL/);
		expect(LISP_SYSTEM_PROMPT).toMatch(/NO model turn in between/);
	});

	it("says the widget is not sent back into its context", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(/the widget is never sent back to you/i);
	});

	it("names the render entry point and the constructors", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(names("ui/render"));
		for (const tag of [
			"ui/stack",
			"ui/row",
			"ui/text",
			"ui/table",
			"ui/input",
			"ui/button",
			"ui/form",
		])
			expect(LISP_SYSTEM_PROMPT).toMatch(names(tag));
	});

	it("draws the line between echoing and rendering", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/Echo when the answer is something to read; render when it is something to use/,
		);
	});

	// Without this the model builds views it cannot get out of: every branch has
	// to be anticipated, because a handler has no way to ask.
	it("says a handler can hand the turn back with ui/send", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(names("ui/send"));
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/joins the conversation as a message from the user/,
		);
	});

	it("says which clicks are worth a turn and which are not", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/Send for judgement, handle it in Lisp for work/,
		);
	});
});
