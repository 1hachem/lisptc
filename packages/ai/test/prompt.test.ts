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
	it("says the answer is the value of the last expression", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/answer as the VALUE of the last expression/i,
		);
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
	// loop with no-op forms (`(identity "Standing by.")`) addressed to a user who
	// cannot see them, burning every step up to the cap.
	it("bans forms that only talk to the user or keep the loop alive", () => {
		expect(LISP_SYSTEM_PROMPT).toMatch(
			/The user cannot see or reply to your intermediate steps/i,
		);
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
});
