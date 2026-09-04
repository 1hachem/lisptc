import { LANGUAGE_REFERENCE } from "@repo/interpreter/source.ts";
import { describe, expect, it } from "vitest";
import { LISP_SYSTEM_PROMPT } from "../src/index.ts";
import { IDENTITY, MAX_STEPS } from "../src/prompts/lisp.ts";
import { snapshotConversation } from "../src/repl.ts";

// The system prompt is the whole contract between the model and this REPL: it
// is the only tool description, API reference and protocol spec the model gets.
// Asserted through the package's public export, since that is what apps/api
// hands the model.
//
// It has two halves, and so does this file. POLICY (below, in `prompts/lisp.ts`)
// owns the agent-loop behaviour: how a turn ends, what a result looks like
// coming back, what never to emit. LANGUAGE_REFERENCE owns everything about the
// language and the REPL itself, and its wording is pinned next to the file it
// lives in — `@repo/interpreter`'s `prose-surfaces.test.ts`. So the language
// rules are asserted here only as an INVENTORY (a built-in the reference forgets
// to name is one the model never calls); their phrasing is not re-pinned.

// The prompt writes a built-in as bare prose (`load-mcp`) or inside a call
// (`(car x)`), so match the name itself rather than any one of those shapes.
const names = (name: string): RegExp => new RegExp(`\\b${name}\\b`);

// Both halves are wrapped markdown, so any sentence can straddle a newline.
// Patterns run against a whitespace-flattened copy, which pins the wording
// without pinning where the wraps happen to fall.
const PROMPT = LISP_SYSTEM_PROMPT.replace(/\s+/g, " ");

describe("assembly", () => {
	it("opens with the identity constant", () => {
		expect(LISP_SYSTEM_PROMPT).toContain(IDENTITY);
	});

	// POLICY defers every language question to the reference, so the reference
	// has to actually arrive: without this the model gets rules about a dialect
	// it was never shown.
	it("carries the language reference verbatim", () => {
		expect(LISP_SYSTEM_PROMPT).toContain(LANGUAGE_REFERENCE);
	});
});

describe("the REPL loop protocol", () => {
	// Without this rule the model falls back on the Common Lisp habit of writing
	// a parenthesised aside in prose, which this dialect reads as code.
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

	// Left to the ending rule alone the model treats stopping as failure and
	// stalls the loop with no-op forms (`(identity "Standing by.")`), burning
	// every step up to the cap. The distinction that has to be exact: the user
	// DOES read what a step echoes (rendering is real work), they just cannot
	// answer mid-loop.
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

	// The cap is the model's other exit besides a form-less reply, so it has to know the
	// loop is bounded at all — that first assertion is the one that bites. The
	// second only guards the coupling: the policy interpolates the same
	// `MAX_STEPS` that stream.ts breaks on, so it cannot fail today, but it
	// would if someone replaced that interpolation with a literal number.
	it("tells the model the loop is capped, and quotes the driver's cap", () => {
		expect(PROMPT).toMatch(/The loop also stops automatically/i);
		expect(LISP_SYSTEM_PROMPT).toContain(`after ${MAX_STEPS} steps`);
	});

	// Lisp in the thinking channel is decoded outside the grammar, so it is both
	// wasted and unrunnable — and the model reliably writes it unless told not to.
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
		expect(PROMPT).toMatch(names(name));
	});

	it("says load-mcp is async: it returns a job and does not block", () => {
		expect(PROMPT).toMatch(/it returns a job immediately and does NOT block/);
		expect(PROMPT).toMatch(
			/`\(job-status job\)` checks progress \(:pending\/:done\/:error\)/,
		);
	});

	it("teaches the <server>/<tool> keyword calling convention", () => {
		expect(PROMPT).toMatch(
			/global named `<server>\/<tool>`, called with keyword args/,
		);
		expect(PROMPT).toMatch(/\(acme\/get_widget :id "42"\)/);
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
		expect(PROMPT).toMatch(/await-all \(list \(load-mcp/);
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
		expect(PROMPT).toMatch(names(n));
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
	// A view is the one thing the model can build that keeps paying after the
	// turn ends, so the prompt has to say both halves: that a handler runs
	// without a model turn, and that the widget never comes back to it.
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

	// The cheap half of the feature: a control that acts on change spends no
	// turn AND no click, so the model has to know it exists to reach for it.
	it("says a select or checkbox can act on change with no submit", () => {
		expect(PROMPT).toMatch(names("on-change"));
		expect(PROMPT).toMatch(/no submit button/);
	});

	it("draws the line between echoing and rendering", () => {
		expect(PROMPT).toMatch(
			/Echo when the answer is something to read; render when it is something to use/,
		);
	});

	// Without this the model builds views it cannot get out of: every branch has
	// to be anticipated, because a handler has no way to ask.
	it("says a handler can hand the turn back with ui/send", () => {
		expect(PROMPT).toMatch(names("ui/send"));
		expect(PROMPT).toMatch(/joins the conversation as a message from the user/);
	});

	it("says which clicks are worth a turn and which are not", () => {
		expect(PROMPT).toMatch(/Send for judgement, handle it in Lisp for work/);
	});
});
