import { providerSpecs } from "@repo/env/providers";
import { langchainGenerate } from "@repo/llm/client";
import type { Generate } from "@repo/llm/llm";
import { isProviderName, providerSpecFor } from "@repo/shared/providers";
import type { CaseInfo, ReportRow } from "./report.ts";

const TIMEOUT_MS = 60_000;

const SYSTEM = [
	"You review a run of an automated eval of a coding agent.",
	"The agent answers by writing programs in a Lisp dialect; the REPL evaluates them and feeds the output back.",
	"You are given how the eval was set up, the conversation, and which assertions passed.",
	"You report only what went wrong.",
	"If the run went according to plan, reply with nothing at all: an empty response, no praise, no summary, no confirmation that it went well.",
	"A run went according to plan when every assertion held, the agent answered the user, and it took no detour worth an engineer's attention.",
	"Otherwise write at most six sentences of plain prose describing what went wrong: what the agent did, at which point it went off, and why that is a problem.",
	"When an assertion failed, say whether the agent was actually at fault or the assertion was too narrow for a reasonable strategy.",
	"Do not restate the transcript, do not use bullet points, and do not repeat the verdicts you were given.",
].join(" ");

export interface Judge {
	provider: string;
	model: string;
}

export function judgeFrom(raw: string | undefined): Judge | undefined {
	if (!raw || raw === "none") return undefined;
	const at = raw.indexOf(":");
	const provider = at === -1 ? raw : raw.slice(0, at);
	if (!isProviderName(provider))
		throw new Error(`EVAL_JUDGE names an unknown provider: ${provider}`);
	const model = at === -1 ? "" : raw.slice(at + 1);
	return {
		provider,
		model: model || providerSpecFor(provider, providerSpecs).defaultModel,
	};
}

export function judgeReachable(judge: Judge): boolean {
	return Boolean(providerSpecFor(judge.provider, providerSpecs).apiKey);
}

function brief(info: CaseInfo | undefined, row: ReportRow): string {
	const checks = row.checks
		.map(
			(check) =>
				`${check.verdict === "true" ? "held" : "FAILED"}: ${check.name}`,
		)
		.join("\n");
	const turns = row.transcript
		.map((line) => `[${line.role}] ${line.content.trimEnd()}`)
		.join("\n");
	return [
		`Task given to the agent: ${info?.seed.map((t) => t.content).join(" / ") ?? "(none recorded)"}`,
		`Agent under test: ${row.provider} ${row.model}`,
		`Outcome: ${row.grade}, ${row.steps} steps (optimal ${row.min}, budget ${row.max}), ${row.halted ? "answered" : "never answered"}.`,
		"",
		"The assertions, written in the same Lisp dialect:",
		info?.checks ?? "(not recorded)",
		"",
		"How each one came out:",
		checks,
		"",
		"The conversation:",
		turns,
	].join("\n");
}

const NOTHING =
	/^[\s.()"'*_-]*(nothing|none|n\/a|no issues?|ok|all good)[\s.()"'*_!-]*$/i;

function nothingSaid(text: string): string {
	return NOTHING.test(text) ? "" : text;
}

export async function recapOf(
	judge: Judge,
	info: CaseInfo | undefined,
	row: ReportRow,
	generate: Generate = langchainGenerate,
): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const result = await generate(
			{
				provider: judge.provider,
				model: judge.model,
				temperature: 0,
				messages: [
					{ role: "system", content: SYSTEM },
					{ role: "user", content: brief(info, row) },
				],
			},
			controller.signal,
		);
		return nothingSaid(result.text.trim());
	} catch (err) {
		return `the judge could not be reached: ${err instanceof Error ? err.message : String(err)}`;
	} finally {
		clearTimeout(timer);
	}
}
