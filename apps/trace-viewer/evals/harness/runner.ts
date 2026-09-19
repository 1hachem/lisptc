import {
	evalCode,
	replResultContent,
	runAgentTurn,
	systemPromptFor,
} from "@repo/ai";
import { Checks } from "@repo/checks/checks";
import type { MockSpec } from "@repo/checks/mocks";
import { Trace } from "@repo/checks/trace";
import { evalsEnv } from "@repo/env/evals";
import type { CaseInfo, ReportRow } from "@repo/evals/report";
import type {
	EvalSpec as BaseEvalSpec,
	EvalRunContext,
	EvalRuntime,
	Target,
	TranscriptEntry,
} from "@repo/evals/runner";
import { createEvalSuite, runCase as runEvalCase } from "@repo/evals/runner";
import type { AgentRepl } from "@repo/repl/repl";
import type { ExtensionsFor } from "./harness.ts";
import { tracedRepl } from "./harness.ts";
import { type Judge, judgeFrom, judgeReachable, recapOf } from "./judge.ts";

export type { RunResult, Target } from "@repo/evals/runner";
export {
	evalConcurrency,
	evalMatrix,
	gate,
	reachable,
} from "@repo/evals/runner";

export interface TraceViewerEvalSpec extends BaseEvalSpec {
	mocks?: MockSpec;
	extensions: ExtensionsFor;
}

export type EvalSpec = TraceViewerEvalSpec;

let judge: Judge | undefined;
let judgeChecked = false;

function activeJudge(): Judge | undefined {
	if (!judgeChecked) {
		judgeChecked = true;
		const wanted = judgeFrom(evalsEnv.EVAL_JUDGE);
		if (wanted && !judgeReachable(wanted))
			console.log(`[evals] no recaps: ${wanted.provider} has no API key set`);
		else judge = wanted;
	}
	return judge;
}

function mockedServers(spec: TraceViewerEvalSpec) {
	return Object.entries(spec.mocks?.servers ?? {}).map(([name, server]) => ({
		name,
		tools: server.tools.map((tool) => tool.name),
		answers: Object.keys(server.calls ?? {}),
		...(server.connectDelayMs === undefined
			? {}
			: { connectDelayMs: server.connectDelayMs }),
		...(server.fails === undefined ? {} : { fails: server.fails }),
		...(server.otherwise === undefined ? {} : { answersAnythingElse: true }),
	}));
}

function open(spec: TraceViewerEvalSpec): EvalRunContext<AgentRepl> {
	const { repl, trace } = tracedRepl({
		...(spec.mocks ? { mocks: spec.mocks } : {}),
		extensions: spec.extensions,
	});
	const checks = new Checks(trace, spec.checks);
	return {
		repl,
		checks,
		trace: {
			beginStep: (step) => trace.beginStep(step),
			reply: (code) => trace.reply(code),
			halt: (answer) => trace.halt(answer),
			mark: () => trace.events.length,
			refusedSince: (mark) =>
				trace.events
					.slice(mark)
					.some((e) => e.kind === "note" || (e.kind === "form" && e.error)),
			errors: () =>
				trace.events.filter(
					(e) =>
						(e.kind === "form" && e.error !== undefined) ||
						(e.kind === "note" && e.severity === "critical"),
				).length,
			skips: () =>
				trace.events.filter(
					(e) => e.kind === "note" && e.severity === "warning",
				).length,
		},
	};
}

const runtime = {
	agent: {
		async eval(repl: AgentRepl, code: string) {
			const result = await evalCode(repl, code);
			repl.takeFinished();
			return result;
		},
		resultContent: replResultContent,
		systemPrompt: (repl: AgentRepl) => systemPromptFor(repl.interp),
		async *turn(
			transcript: TranscriptEntry[],
			options: {
				repl: AgentRepl;
				maxSteps: number;
				target: Target;
				system: string;
			},
		) {
			for await (const event of runAgentTurn(transcript, {
				repl: options.repl,
				maxSteps: options.maxSteps,
				config: {
					provider: options.target.provider,
					model: options.target.model,
					system: options.system,
				},
			})) {
				if (
					event.type === "assistant" ||
					event.type === "result" ||
					event.type === "halt" ||
					event.type === "silent" ||
					event.type === "failed"
				)
					yield event;
			}
		},
	},
	open,
	validateChecks(checks: string) {
		new Checks(new Trace(), checks).evaluate(0);
	},
	mocks: mockedServers,
	reviewer() {
		const reviewer = activeJudge();
		if (!reviewer) return undefined;
		return {
			describe: () => `${reviewer.provider} · ${reviewer.model}`,
			recap: (info: CaseInfo | undefined, row: ReportRow) =>
				recapOf(reviewer, info, row),
		};
	},
} satisfies EvalRuntime<TraceViewerEvalSpec, AgentRepl>;

const suite = createEvalSuite(runtime);

export const evalCase = suite.evalCase;

export function runCase(spec: TraceViewerEvalSpec, target: Target) {
	return runEvalCase(runtime, spec, target);
}
