import { EvalException } from "@repo/interpreter/errors";
import { boot, Interp, runAsync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import type { EmbeddingModel, EmbedRequest } from "@repo/shared/embedding";
import type {
	JudgeRequest,
	Judgment,
	SystemOneModel,
	Verdict,
} from "@repo/shared/system-one";
import { type SemanticHost, semanticExtension } from "../src/semantic.ts";
import { semanticHost } from "../src/semantic-host.ts";

export type Answer = (
	question: Judgment,
	id: string,
	req: JudgeRequest,
) => Verdict;

function repl(host: Partial<SemanticHost>) {
	const interp = new Interp({
		extensions: [semanticExtension({ ...semanticHost, ...host })],
	});
	boot(interp);
	return {
		ev: async (code: string): Promise<string> =>
			str((await runAsync(interp, code)).value),
		failure: async (code: string): Promise<string> => {
			try {
				await runAsync(interp, code);
			} catch (ex) {
				return ex instanceof EvalException ? ex.message : String(ex);
			}
			throw new Error("expected a failure");
		},
	};
}

export interface Budget {
	calls?: number;
}

function spend(seen: unknown[], budget: Budget): void {
	if (budget.calls !== undefined && seen.length > budget.calls)
		throw new Error(`model asked more than ${budget.calls} times`);
}

export function judging(answer: Answer, budget: Budget = {}) {
	const seen: JudgeRequest[] = [];
	const systemOne: SystemOneModel = {
		provider: "test",
		model: "jev-test",
		judge: async (req) => {
			seen.push(req);
			spend(seen, budget);
			const answers: Record<string, Verdict> = {};
			for (const [id, question] of Object.entries(req.questions))
				answers[id] = answer(question, id, req);
			return { answers, model: "jev-test" };
		},
	};
	return { seen, ...repl({ systemOne }) };
}

export function embedding(
	vectors: Record<string, number[]>,
	budget: Budget & { model?: string; once?: boolean } = {},
) {
	const seen: EmbedRequest[] = [];
	const served = new Set<string>();
	const embedder: EmbeddingModel = {
		provider: "test",
		model: "embed-test",
		embed: async (req) => {
			seen.push(req);
			spend(seen, budget);
			if (budget.model !== undefined && req.model !== budget.model)
				throw new Error(`no model ${req.model ?? "by default"}`);
			return {
				vectors: req.inputs.map((text) => {
					const v = vectors[text];
					if (v === undefined) throw new Error(`no test vector for ${text}`);
					if (budget.once && served.has(text))
						throw new Error(`${text} embedded twice`);
					served.add(text);
					return v;
				}),
				model: "embed-test",
			};
		},
	};
	return { seen, ...repl({ embedder }) };
}

export function yes(p: number): Verdict {
	return { type: "noul", noul: p };
}

export function picked(
	choice: string,
	probabilities: Record<string, number>,
): Verdict {
	return { type: "choice", choice, confidence: 0.5, probabilities };
}

export function rated(score: number): Verdict {
	return { type: "score", score, confidence: 0.5 };
}

export function itemAt(id: string): number {
	return Number(id.slice(1));
}
