import type { AgentRepl } from "@repo/repl/repl";
import { evalCode, type TranscriptEntry } from "./repl.ts";
import type { TurnEvent } from "./turn.ts";

export interface RunnerContext {
	readonly repl: AgentRepl;
	readonly signal: AbortSignal;
}

export type TurnRunner = (
	transcript: TranscriptEntry[],
	context: RunnerContext,
) => AsyncIterable<TurnEvent>;

function reasonOf(signal: AbortSignal): string {
	const { reason } = signal;
	if (reason instanceof Error && reason.name === "TimeoutError")
		return "the code ran past its deadline";
	return "cancelled";
}

function stopping(signal: AbortSignal): Promise<string> {
	return new Promise((stop) => {
		if (signal.aborted) return stop(reasonOf(signal));
		signal.addEventListener("abort", () => stop(reasonOf(signal)), {
			once: true,
		});
	});
}

function answerOf(output: string, results: readonly string[]): string {
	const value = results.at(-1);
	if (value === undefined) return output;
	return output === "" ? value : `${output}${value}`;
}

export function codeRunner(code: string): TurnRunner {
	return async function* (_transcript, { repl, signal }) {
		const stepId = crypto.randomUUID();
		const ran = await Promise.race([
			evalCode(repl, code, stepId),
			stopping(signal),
		]);
		if (typeof ran === "string") {
			repl.interp.async.abortAll();
			yield { type: "failed", message: ran, error: new Error(ran) };
			return;
		}
		const { output, display, error, annotations, failed, held, results } = ran;
		yield {
			type: "result",
			step: 1,
			output,
			display,
			error,
			annotations,
			failed,
			results,
			...(held ? { held: true as const } : {}),
		};
		if ((error || failed) && !held) {
			yield { type: "failed", message: output, error: new Error(output) };
			return;
		}
		yield { type: "halt", answer: answerOf(output, results), steps: 1 };
	};
}
