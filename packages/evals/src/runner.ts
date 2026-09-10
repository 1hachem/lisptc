import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	evalCode,
	LISP_SYSTEM_PROMPT,
	replResultContent,
	runAgentTurn,
	type TranscriptEntry,
} from "@repo/ai";
import {
	defaultProviderName,
	isProviderName,
	type ProviderName,
	providerSpecFor,
} from "@repo/shared/providers";
import { test } from "vitest";
import { Checks } from "./checks.ts";
import { tracedRepl } from "./harness.ts";
import type { MockSpec } from "./mocks.ts";
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
import { Trace } from "./trace.ts";

export type SeedEntry = { user: string } | { assistant: string };

export interface EvalSpec {
	min: number;
	max: number;
	checks: string;
	mocks?: MockSpec;
	seed?: SeedEntry[];
	samples?: number;
	passRate?: number;
	system?: string;
}

export interface Target {
	provider: ProviderName;
	model: string;
}

export interface RunResult {
	provider: ProviderName;
	model: string;
	grade: Grade;
	steps: number;
	min: number;
	max: number;
	halted: boolean;
	answer: string;
	inputTokens: number;
	outputTokens: number;
	durationMs: number;
	errors: number;
	skips: number;
	checks: CheckOutcome[];
	transcript: TranscriptLine[];
}

const REPORT_DIR = process.env.EVAL_REPORT_DIR ?? join(process.cwd(), ".evals");

const STARTED_AT = new Date()
	.toISOString()
	.replace(/\.\d+Z$/, "")
	.replace(/:/g, "-");

function slug(text: string): string {
	return text
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

function reportName(targets: Target[]): string {
	const named = targets
		.slice(0, 3)
		.map((t) => slug(`${t.provider}-${t.model}`));
	if (targets.length > 3) named.push(`and-${targets.length - 3}-more`);
	return `${STARTED_AT}__${named.join("__")}.json`;
}

const rows: ReportRow[] = [];

const cases: CaseInfo[] = [];

export function evalMatrix(): Target[] {
	const raw = process.env.EVAL_MATRIX;
	if (!raw) {
		const provider = defaultProviderName();
		return [{ provider, model: providerSpecFor(provider).defaultModel }];
	}
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const at = entry.indexOf(":");
			const name = at === -1 ? entry : entry.slice(0, at);
			if (!isProviderName(name))
				throw new Error(`EVAL_MATRIX names an unknown provider: ${name}`);
			const model = at === -1 ? "" : entry.slice(at + 1);
			return {
				provider: name,
				model: model || providerSpecFor(name).defaultModel,
			};
		});
}

export function reachable(provider: ProviderName): boolean {
	return Boolean(providerSpecFor(provider).apiKey);
}

export async function runCase(
	spec: EvalSpec,
	target: Target,
): Promise<RunResult> {
	const { repl, trace } = tracedRepl(spec.mocks ? { mocks: spec.mocks } : {});
	const checks = new Checks(trace, spec.checks);
	const transcript: TranscriptEntry[] = [];
	const seen: TranscriptLine[] = [];

	trace.beginStep(0);
	for (const entry of spec.seed ?? []) {
		if ("user" in entry) {
			transcript.push({ role: "user", content: entry.user });
			seen.push({ role: "user", content: entry.user });
			continue;
		}
		const { output, error } = await evalCode(repl, entry.assistant);
		repl.takeFinished();
		transcript.push({ role: "assistant", content: entry.assistant });
		transcript.push({
			role: "tool",
			content: replResultContent(output, error),
		});
		seen.push({ role: "assistant", content: entry.assistant });
		seen.push({ role: "tool", content: output });
	}

	let steps = 0;
	let halted = false;
	let answer = "";
	let inputTokens = 0;
	let outputTokens = 0;
	const startedAt = Date.now();

	for await (const event of runAgentTurn(transcript, {
		repl,
		maxSteps: spec.max,
		config: {
			provider: target.provider,
			model: target.model,
			system: spec.system ?? LISP_SYSTEM_PROMPT,
		},
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
			trace.halt();
			checks.evaluate(steps);
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
		answer,
		inputTokens,
		outputTokens,
		durationMs: Date.now() - startedAt,
		errors: trace.events.filter(
			(e) =>
				(e.kind === "form" && e.error !== undefined) ||
				(e.kind === "note" && e.severity === "critical"),
		).length,
		skips: trace.events.filter(
			(e) => e.kind === "note" && e.severity === "warning",
		).length,
		checks: verdicts,
		transcript: seen,
	};
}

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

const RULE = "─".repeat(72);

function speaker(line: TranscriptLine): string {
	if (line.role === "user") return "user";
	return line.role === "assistant" ? "agent" : "repl";
}

export function formatRun(name: string, run: RunResult): string {
	const band = `optimal ${run.min}, budget ${run.max}`;
	const ending = run.halted
		? `answered at step ${run.steps} (${band})`
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
	out.push(RULE);
	return out.join("\n");
}

function failures(runs: RunResult[]): string {
	return runs
		.flatMap((run, sample) => {
			const named = run.checks
				.filter((check) => check.verdict === "false")
				.map((check) => check.name);
			if (!run.halted) named.unshift(`never answered in ${run.steps} steps`);
			return named.map((what) => `run ${sample + 1}: ${what}`);
		})
		.join(", ");
}

function mockedServers(spec: EvalSpec): MockedServer[] {
	return Object.entries(spec.mocks?.servers ?? {}).map(([name, server]) => ({
		name,
		tools: server.tools.map((tool) => tool.name),
		answers: Object.keys(server.calls ?? {}),
		...(server.connectDelayMs === undefined
			? {}
			: { connectDelayMs: server.connectDelayMs }),
		...(server.fails === undefined ? {} : { fails: server.fails }),
	}));
}

function seedOf(spec: EvalSpec): SeedTurn[] {
	return (spec.seed ?? []).map((entry) =>
		"user" in entry
			? { role: "user" as const, content: entry.user }
			: { role: "assistant" as const, content: entry.assistant },
	);
}

function describeCase(name: string, spec: EvalSpec): CaseInfo {
	return {
		name,
		min: spec.min,
		max: spec.max,
		samples: spec.samples ?? 1,
		...(spec.passRate === undefined ? {} : { passRate: spec.passRate }),
		systemPrompt: spec.system === undefined ? "default" : "custom",
		checks: spec.checks.trim(),
		seed: seedOf(spec),
		mocks: mockedServers(spec),
	};
}

export function evalCase(name: string, spec: EvalSpec): void {
	new Checks(new Trace(), spec.checks).evaluate(0);
	cases.push(describeCase(name, spec));
	const samples = spec.samples ?? 1;
	for (const target of evalMatrix()) {
		const label = `${name} [${target.provider} · ${target.model}]`;
		test.skipIf(!reachable(target.provider))(label, async () => {
			const runs: RunResult[] = [];
			for (let sample = 0; sample < samples; sample++) {
				const run = await runCase(spec, target);
				runs.push(run);
				rows.push({ ...run, case: name, sample: sample + 1 });
				console.log(formatRun(name, run));
			}
			writeReport();

			const passed = runs.filter((run) => run.grade === "pass").length;
			const rate = passed / runs.length;
			const summary = runs
				.map((run) => `${run.grade} in ${run.steps} steps`)
				.join("; ");

			if (samples > 1) {
				const floor = spec.passRate ?? 1;
				if (rate < floor)
					throw new Error(
						`pass rate ${rate.toFixed(2)} below ${floor} — ${summary}${
							failures(runs) ? ` (${failures(runs)})` : ""
						}`,
					);
				return;
			}
			if (runs[0].grade === "fail")
				throw new Error(
					`${summary}${failures(runs) ? ` — ${failures(runs)}` : ""}`,
				);
		});
	}
}

function writeReport(): void {
	const targets = evalMatrix();
	const report: Report = {
		startedAt: STARTED_AT,
		sha: process.env.GITHUB_SHA ?? "",
		targets,
		cases,
		rows,
	};
	mkdirSync(REPORT_DIR, { recursive: true });
	writeFileSync(
		join(REPORT_DIR, reportName(targets)),
		`${JSON.stringify(reportSchema.parse(report), null, 2)}\n`,
	);
}
