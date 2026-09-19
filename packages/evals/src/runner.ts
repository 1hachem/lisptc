import { writeFileSync } from "node:fs";
import { evalsEnv } from "@repo/env/evals";
import type { ProviderName } from "@repo/shared/providers";
import { test } from "vitest";
import type {
	CaseInfo,
	CheckOutcome,
	Grade,
	MockedServer,
	Report,
	ReportRow,
	SeedTurn,
	TranscriptLine,
} from "./report.ts";
import { reportSchema } from "./report.ts";
import { shardPath } from "./shards.ts";
import { evalMatrix, reachable, type Target } from "./targets.ts";

export type { Target } from "./targets.ts";
export { evalConcurrency, evalMatrix, reachable } from "./targets.ts";

export type SeedEntry = { user: string } | { assistant: string };

export interface CheckEvaluator {
	evaluate(step: number): void;
	results(): CheckOutcome[];
}

export type TranscriptEntry =
	| { role: "user"; content: string }
	| { role: "assistant"; content: string }
	| { role: "tool"; content: string };

export type EvalTurnEvent =
	| {
			type: "assistant";
			code: string;
			meta: { inputTokens?: number; outputTokens?: number };
	  }
	| { type: "result"; output: string }
	| { type: "halt"; answer: string }
	| { type: "silent" }
	| { type: "failed"; message: string };

export interface EvalResult {
	output: string;
	error: boolean;
	annotations: { step: Record<string, unknown> };
}

export interface AgentDriver<Repl> {
	eval(repl: Repl, code: string): Promise<EvalResult>;
	resultContent(
		output: string,
		error: boolean,
		step: Record<string, unknown>,
	): string;
	systemPrompt(repl: Repl): string;
	turn(
		transcript: TranscriptEntry[],
		options: {
			repl: Repl;
			maxSteps: number;
			target: Target;
			system: string;
		},
	): AsyncIterable<EvalTurnEvent>;
}

export interface EvalTrace {
	beginStep(step: number): void;
	reply(code: string): void;
	halt(answer: string): void;
	mark(): number;
	refusedSince(mark: number): boolean;
	errors(): number;
	skips(): number;
}

export interface EvalRunContext<Repl> {
	repl: Repl;
	trace: EvalTrace;
	checks: CheckEvaluator;
}

export interface EvalSpec {
	min: number;
	max: number;
	checks: string;
	prelude?: string;
	seed?: SeedEntry[];
	samples?: number;
	minScore?: number;
	system?: string;
}

export interface RunResult {
	provider: ProviderName;
	model: string;
	grade: Grade;
	steps: number;
	min: number;
	max: number;
	halted: boolean;
	silent: boolean;
	answer: string;
	inputTokens: number;
	outputTokens: number;
	durationMs: number;
	errors: number;
	skips: number;
	checks: CheckOutcome[];
	transcript: TranscriptLine[];
}

export interface EvalReviewer<Spec extends EvalSpec> {
	describe(): string;
	recap(
		info: CaseInfo | undefined,
		row: ReportRow,
		spec: Spec,
	): Promise<string>;
}

export interface EvalRuntime<Spec extends EvalSpec, Repl> {
	agent: AgentDriver<Repl>;
	open(spec: Spec): EvalRunContext<Repl>;
	validateChecks(checks: string): void;
	mocks(spec: Spec): MockedServer[];
	reviewer?(): EvalReviewer<Spec> | undefined;
}

const DEFAULT_MIN_SCORE = 0.5;

const STARTED_AT = new Date()
	.toISOString()
	.replace(/\.\d+Z$/, "")
	.replace(/:/g, "-");

const SHARD_ID = `${STARTED_AT}-${process.pid}`;

const RULE = "─".repeat(72);

function grade(
	spec: EvalSpec,
	verdicts: CheckOutcome[],
	steps: number,
	halted: boolean,
): Grade {
	if (verdicts.some((check) => check.verdict === "false")) return "fail";
	if (!halted) return "fail";
	if (steps > spec.max) return "fail";
	return steps <= spec.min ? "pass" : "degraded";
}

function speaker(line: TranscriptLine): string {
	if (line.role === "user") return "user";
	return line.role === "assistant" ? "agent" : "repl";
}

export function formatRun(name: string, run: ReportRow): string {
	const band = `optimal ${run.min}, budget ${run.max}`;
	const ending = run.halted
		? `answered at step ${run.steps} (${band})`
		: run.silent
			? `NO REPLY — the model returned nothing at step ${run.steps + 1}`
			: `NEVER ANSWERED — ran to the ${run.steps}-step cap`;
	const out: string[] = [
		RULE,
		`${name}  [${run.provider} · ${run.model}]`,
		`${run.grade.toUpperCase()} · ${ending} · ${run.inputTokens} in / ${run.outputTokens} out · ${run.durationMs}ms`,
		RULE,
	];
	for (const line of run.transcript) {
		out.push(
			`${speaker(line).padEnd(5)} │ ${line.content.trimEnd().split("\n").join("\n      │ ")}`,
		);
	}
	out.push(RULE);
	for (const check of run.checks) {
		const mark = check.verdict === "true" ? "✓" : "✗";
		const when =
			check.step === undefined ? "" : ` (decided at step ${check.step})`;
		out.push(`${mark} ${check.name}${when}`);
	}
	if (run.recap) {
		out.push(RULE);
		out.push(`recap by ${run.judge ?? "the judge"}:`);
		out.push(run.recap);
	}
	out.push(RULE);
	return out.join("\n");
}

export interface CaseScore {
	passed: number;
	total: number;
	ratio: number;
}

export function caseScore(runs: RunResult[]): CaseScore {
	let passed = 0;
	let total = 0;
	for (const run of runs) {
		passed += run.checks.filter((check) => check.verdict === "true").length;
		total += run.checks.length;
		if (run.halted) passed += 1;
		total += 1;
	}
	return { passed, total, ratio: passed / total };
}

export function gate(
	spec: EvalSpec,
	runs: RunResult[],
): { ok: boolean; line: string } {
	const score = caseScore(runs);
	const floor = spec.minScore ?? DEFAULT_MIN_SCORE;
	const summary = runs
		.map((run) => `${run.grade} in ${run.steps} steps`)
		.join("; ");
	const missed = failures(runs);
	const head = `scored ${score.passed}/${score.total} (floor ${floor}) — ${summary}`;
	return {
		ok: score.ratio >= floor,
		line: missed ? `${head} — ${missed}` : head,
	};
}

function failures(runs: RunResult[]): string {
	return runs
		.flatMap((run, sample) => {
			const named = run.checks
				.filter((check) => check.verdict === "false")
				.map((check) => check.name);
			if (run.silent)
				named.unshift(`the model returned nothing at step ${run.steps + 1}`);
			else if (!run.halted)
				named.unshift(`never answered in ${run.steps} steps`);
			return named.map((what) => `run ${sample + 1}: ${what}`);
		})
		.join(", ");
}

function seedOf(spec: EvalSpec): SeedTurn[] {
	return (spec.seed ?? []).map((entry) =>
		"user" in entry
			? { role: "user" as const, content: entry.user }
			: { role: "assistant" as const, content: entry.assistant },
	);
}

function describeCase<Spec extends EvalSpec, Repl>(
	runtime: EvalRuntime<Spec, Repl>,
	name: string,
	spec: Spec,
): CaseInfo {
	return {
		name,
		min: spec.min,
		max: spec.max,
		samples: spec.samples ?? 1,
		minScore: spec.minScore ?? DEFAULT_MIN_SCORE,
		systemPrompt: spec.system === undefined ? "default" : "custom",
		checks: spec.checks.trim(),
		seed: seedOf(spec),
		mocks: runtime.mocks(spec),
	};
}

export async function runCase<Spec extends EvalSpec, Repl>(
	runtime: EvalRuntime<Spec, Repl>,
	spec: Spec,
	target: Target,
): Promise<RunResult> {
	const { repl, trace, checks } = runtime.open(spec);
	const transcript: TranscriptEntry[] = [];
	const seen: TranscriptLine[] = [];

	if (spec.prelude !== undefined) {
		const before = trace.mark();
		const { output, error } = await runtime.agent.eval(repl, spec.prelude);
		if (error || trace.refusedSince(before))
			throw new Error(`the prelude did not run: ${output}`);
	}

	trace.beginStep(0);
	for (const entry of spec.seed ?? []) {
		if ("user" in entry) {
			transcript.push({ role: "user", content: entry.user });
			seen.push({ role: "user", content: entry.user });
			continue;
		}
		const { output, error, annotations } = await runtime.agent.eval(
			repl,
			entry.assistant,
		);
		transcript.push({ role: "assistant", content: entry.assistant });
		transcript.push({
			role: "tool",
			content: runtime.agent.resultContent(output, error, annotations.step),
		});
		seen.push({ role: "assistant", content: entry.assistant });
		seen.push({ role: "tool", content: output });
	}

	let steps = 0;
	let halted = false;
	let silent = false;
	let answer = "";
	let inputTokens = 0;
	let outputTokens = 0;
	const startedAt = Date.now();

	for await (const event of runtime.agent.turn(transcript, {
		repl,
		maxSteps: spec.max,
		target,
		system: spec.system ?? runtime.agent.systemPrompt(repl),
	})) {
		if (event.type === "assistant") {
			steps += 1;
			trace.beginStep(steps);
			trace.reply(event.code);
			seen.push({ role: "assistant", content: event.code });
			inputTokens = event.meta.inputTokens ?? inputTokens;
			outputTokens += event.meta.outputTokens ?? 0;
			continue;
		}
		if (event.type === "result") {
			seen.push({ role: "tool", content: event.output });
			checks.evaluate(steps);
			continue;
		}
		if (event.type === "halt") {
			halted = true;
			answer = event.answer;
			trace.halt(event.answer);
			checks.evaluate(steps);
			continue;
		}
		if (event.type === "silent") {
			silent = true;
			continue;
		}
		if (event.type === "failed") throw new Error(event.message);
	}

	const verdicts = checks.results();
	return {
		provider: target.provider,
		model: target.model,
		grade: grade(spec, verdicts, steps, halted),
		steps,
		min: spec.min,
		max: spec.max,
		halted,
		silent,
		answer,
		inputTokens,
		outputTokens,
		durationMs: Date.now() - startedAt,
		errors: trace.errors(),
		skips: trace.skips(),
		checks: verdicts,
		transcript: seen,
	};
}

export function createEvalSuite<Spec extends EvalSpec, Repl>(
	runtime: EvalRuntime<Spec, Repl>,
): { evalCase(name: string, spec: Spec): void } {
	const rows: ReportRow[] = [];
	const cases: CaseInfo[] = [];
	return {
		evalCase(name, spec) {
			runtime.validateChecks(spec.checks);
			cases.push(describeCase(runtime, name, spec));
			const samples = spec.samples ?? 1;
			for (const target of evalMatrix()) {
				const label = `${name} [${target.provider} · ${target.model}]`;
				test.skipIf(!reachable(target.provider))(label, async () => {
					const runs: RunResult[] = [];
					for (let sample = 0; sample < samples; sample++) {
						const run = await runCase(runtime, spec, target);
						const row: ReportRow = { ...run, case: name, sample: sample + 1 };
						const reviewer = runtime.reviewer?.();
						if (reviewer) {
							row.judge = reviewer.describe();
							const recap = await reviewer.recap(
								cases.find((info) => info.name === name),
								row,
								spec,
							);
							if (recap) row.recap = recap;
						}
						runs.push(run);
						rows.push(row);
						console.log(formatRun(name, row));
					}
					writeReport(cases, rows);

					const verdict = gate(spec, runs);
					console.log(`${label}: ${verdict.line}`);
					if (!verdict.ok) throw new Error(verdict.line);
				});
			}
		},
	};
}

function writeReport(cases: CaseInfo[], rows: ReportRow[]): void {
	const targets = evalMatrix();
	const report: Report = {
		startedAt: STARTED_AT,
		sha: evalsEnv.GITHUB_SHA,
		targets,
		cases,
		rows,
	};
	writeFileSync(
		shardPath(SHARD_ID),
		`${JSON.stringify(reportSchema.parse(report), null, 2)}\n`,
	);
}
