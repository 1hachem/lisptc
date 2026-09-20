import { Interp } from "@repo/interpreter/lisp";
import { describe, expect, it } from "vitest";
import { IDENTITY, MAX_STEPS, systemPromptFor } from "../src/prompts/lisp.ts";
import { snapshotConversation } from "../src/repl.ts";

const PROMPT = systemPromptFor(new Interp());

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

	it("says a bare result name ends the turn instead of showing it", () => {
		expect(PROMPT).toMatch(/ENDS THE TURN/);
		expect(PROMPT).toMatch(/most expensive typo in the language/i);
	});

	it("says to stop when the request is met", () => {
		expect(PROMPT).toMatch(/Do what was asked, then stop/);
		expect(PROMPT).toMatch(/do not go on to snapshot it/i);
	});
});

describe("the REPL loop protocol", () => {
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

describe("learning from a mistake", () => {
	it("tells the agent to store the fix the moment a mistake is solved", () => {
		expect(PROMPT).toMatch(/LEARN FROM EVERY MISTAKE/);
		expect(PROMPT).toMatch(/before you move on/i);
	});

	it("names both kinds the solution can be stored as", () => {
		expect(PROMPT).toMatch(/A DECLARATIVE one is prose/);
		expect(PROMPT).toMatch(/A PROCEDURAL one is a quoted form/);
	});

	it("forbids hooking the memory to the call that failed", () => {
		expect(PROMPT).toMatch(/NEVER TO THE CALL THAT FAILED/);
		expect(PROMPT).toMatch(/too late to stop it/);
		expect(PROMPT).toMatch(/If it only fires as the mistake happens/);
	});

	it("says to hook the last step that worked before the mistake", () => {
		expect(PROMPT).toMatch(/HOOK IT TO WHAT PRECEDES THE ERROR/);
		expect(PROMPT).toMatch(/HOOK THE LAST THING THAT WORKED ON THE WAY IN/);
		expect(PROMPT).toContain(`:on '(call (load-mcp "acme"))`);
		expect(PROMPT).toMatch(/before you can name a single tool/);
	});

	it("says using a memory opens a window where it can be revised", () => {
		expect(PROMPT).toMatch(/EVERY USE OPENS A WINDOW OF PLASTICITY/);
		expect(PROMPT).toMatch(/until the end of that step/);
		expect(PROMPT).toMatch(/Outside the window revise is an error/);
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
});
