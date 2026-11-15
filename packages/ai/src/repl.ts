import type { ConversationRecord } from "@repo/interpreter/conversation";
import type { Effect } from "@repo/interpreter/effects";
import type { AgentRepl, EvalOutput, LiveEntries } from "@repo/repl/repl";
import type { Entry } from "@repo/shared/journal";

export function stripFences(text: string): string {
	const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
	return m ? m[1] : text.trim();
}

export function replResultContent(output: string, error: boolean): string {
	return JSON.stringify({
		type: "tool_result",
		source: "lisp-repl",
		error,
		output: output || "(no output)",
	});
}

async function outcomeOf(
	repl: AgentRepl,
	run: () => Promise<EvalOutput>,
): Promise<{
	output: string;
	display: string;
	error: boolean;
	entries: readonly Entry[];
	effects: readonly Effect[];
	notes: readonly ConversationRecord[];
	failed: boolean;
	failure: string;
	held: boolean;
	results: readonly string[];
}> {
	try {
		const {
			model,
			user,
			entries,
			effects,
			notes,
			failed,
			failure = "",
			held,
			results,
		} = await run();
		return {
			output: model,
			display: without(user, failure),
			failure,
			error: false,
			entries,
			effects,
			notes,
			failed,
			held,
			results,
		};
	} catch (ex) {
		const restored = await repl.recover();
		const msg = ex instanceof Error ? ex.message : String(ex);
		const text =
			restored === undefined
				? `REPL error: ${msg} (interpreter was reset, definitions lost)`
				: `REPL error: ${msg} (interpreter restored to its last checkpoint, changes since then lost)`;
		return {
			output: text,
			display: "",
			failure: text,
			error: true,
			entries: [],
			effects: [],
			notes: [],
			failed: true,
			held: false,
			results: [],
		};
	}
}

function without(text: string, part: string): string {
	const at = part === "" ? -1 : text.lastIndexOf(part);
	return at < 0 ? text : text.slice(0, at) + text.slice(at + part.length);
}

export function evalCode(
	repl: AgentRepl,
	code: string,
	origin?: string,
	live?: LiveEntries,
) {
	return outcomeOf(repl, () => repl.evalOutput(code, origin, live));
}

export function evalMessageCode(
	repl: AgentRepl,
	code: string,
	origin?: string,
) {
	return outcomeOf(repl, () => repl.evalMessage(code, origin));
}
