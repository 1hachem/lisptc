export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export interface NoulQuestion {
	readonly type: "noul";
	readonly instructions: JsonValue;
	readonly criteria?: { readonly true: JsonValue; readonly false: JsonValue };
}

export interface ChoiceQuestion {
	readonly type: "choice";
	readonly instructions: JsonValue;
	readonly criteria: Readonly<Record<string, JsonValue>>;
}

export interface ScoreQuestion {
	readonly type: "score";
	readonly instructions: JsonValue;
	readonly criteria: readonly JsonValue[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
	readonly type: "noul";
	readonly noul: number;
}

export interface ChoiceAnswer {
	readonly type: "choice";
	readonly choice: string;
	readonly confidence: number;
	readonly probabilities: Readonly<Record<string, number>>;
}

export interface ScoreAnswer {
	readonly type: "score";
	readonly score: number;
	readonly confidence: number;
	readonly legend: Readonly<Record<string, JsonValue>>;
	readonly probabilities: Readonly<Record<string, number>>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JudgeRequest {
	readonly state: JsonValue;
	readonly questions: Readonly<Record<string, Question>>;
	readonly model?: string;
}

export interface Judged {
	readonly model: string;
	readonly answers: Readonly<Record<string, Answer>>;
	readonly calibrated: boolean;
	readonly usage?: {
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly cost?: number;
	};
}

export type Judge = (
	req: JudgeRequest,
	signal?: AbortSignal,
) => Promise<Judged>;

export function noul(
	instructions: JsonValue,
	criteria?: { readonly true: JsonValue; readonly false: JsonValue },
): NoulQuestion {
	return criteria === undefined
		? { type: "noul", instructions }
		: { type: "noul", instructions, criteria };
}

export function choice(
	instructions: JsonValue,
	criteria: Readonly<Record<string, JsonValue>>,
): ChoiceQuestion {
	return { type: "choice", instructions, criteria };
}

export function score(
	instructions: JsonValue,
	criteria: readonly JsonValue[],
): ScoreQuestion {
	return { type: "score", instructions, criteria };
}

export type JudgeProtocol = "decisions" | "chat";

export interface JudgeSpec {
	readonly label: string;
	readonly apiKey: string | undefined;
	readonly apiKeyEnv: string;
	readonly baseUrl: string;
	readonly defaultModel: string;
	readonly protocol: JudgeProtocol;
}

export const JUDGE_NAMES = ["jev", "openrouter"] as const;

export type JudgeName = (typeof JUDGE_NAMES)[number];

export const JUDGE_OFF = "off";

export type JudgeChoice = JudgeName | typeof JUDGE_OFF;

export const JUDGE_CHOICES = [...JUDGE_NAMES, JUDGE_OFF] as const;

export const DEFAULT_JUDGE: JudgeName = "jev";

export interface JudgeReport {
	readonly name: JudgeName;
	readonly model: string;
	readonly calibrated: boolean;
	readonly ready: boolean;
}

export function isJudgeName(name: string): name is JudgeName {
	return (JUDGE_NAMES as readonly string[]).includes(name);
}

export function judgeSpecFor(
	name: string,
	specs: Record<JudgeName, JudgeSpec>,
): JudgeSpec {
	if (!isJudgeName(name))
		throw new Error(
			`unknown judge "${name}", expected one of ${JUDGE_NAMES.join(", ")}`,
		);
	return specs[name];
}

export function judgeReports(
	specs: Record<JudgeName, JudgeSpec>,
	first: JudgeName = DEFAULT_JUDGE,
): JudgeReport[] {
	const order = [first, ...JUDGE_NAMES.filter((name) => name !== first)];
	return order.map((name) => ({
		name,
		model: specs[name].defaultModel,
		calibrated: specs[name].protocol === "decisions",
		ready: specs[name].apiKey !== undefined,
	}));
}

const ERROR_BODY_CHARS = 400;

export const RETRYABLE = new Set([408, 429, 500, 502, 503, 529]);

export const ATTEMPTS = 4;

export const BACKOFF_MS = 800;

const TOP_LOGPROBS = 20;

const CHAT_INSTRUCTIONS = [
	"You answer questions about a state, and you answer nothing else.",
	"A noul answer is your probability, between 0 and 1, that the statement holds of the state.",
	"A choice answer is one of the offered criteria keys, and nothing outside that set.",
	"A score answer is the index of the level that fits, counting from 0.",
	"Each choice and score carries a confidence between 0 and 1.",
	"Reply with the JSON object the schema describes.",
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: unknown, label: string, what: string): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(
			`${label} answered ${what} with something that is not a number`,
		);
	return Math.min(1, Math.max(0, value));
}

function distribution(
	value: unknown,
	keys: readonly string[],
	chosen: string,
): Record<string, number> {
	if (!isRecord(value)) return oneHot(keys, chosen);
	const out: Record<string, number> = {};
	for (const key of keys) {
		const weight = value[key];
		out[key] =
			typeof weight === "number" && Number.isFinite(weight) ? weight : 0;
	}
	return out;
}

function oneHot(
	keys: readonly string[],
	chosen: string,
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const key of keys) out[key] = key === chosen ? 1 : 0;
	return out;
}

function readAnswer(
	question: Question,
	value: unknown,
	label: string,
	what: string,
): Answer {
	if (!isRecord(value))
		throw new Error(
			`${label} answered ${what} with something that is not an answer`,
		);
	if (question.type === "noul")
		return { type: "noul", noul: bounded(value.noul, label, what) };
	if (question.type === "choice") {
		const keys = Object.keys(question.criteria);
		const picked = value.choice;
		if (typeof picked !== "string" || !keys.includes(picked))
			throw new Error(
				`${label} answered ${what} with "${String(picked)}", which is not one of ${keys.join(", ")}`,
			);
		return {
			type: "choice",
			choice: picked,
			confidence: bounded(value.confidence, label, what),
			probabilities: distribution(value.probabilities, keys, picked),
		};
	}
	const levels = question.criteria.length;
	const picked = value.score;
	if (
		typeof picked !== "number" ||
		!Number.isInteger(picked) ||
		picked < 0 ||
		picked >= levels
	)
		throw new Error(
			`${label} answered ${what} with "${String(picked)}", which is not a level between 0 and ${levels - 1}`,
		);
	const keys = question.criteria.map((_level, index) => String(index));
	return {
		type: "score",
		score: picked,
		confidence: bounded(value.confidence, label, what),
		legend: isRecord(value.legend)
			? (value.legend as Readonly<Record<string, JsonValue>>)
			: Object.fromEntries(
					question.criteria.map((level, index) => [String(index), level]),
				),
		probabilities: distribution(value.probabilities, keys, String(picked)),
	};
}

function usageIn(value: unknown): Judged["usage"] {
	if (!isRecord(value)) return undefined;
	const input = value.inputTokens ?? value.input_tokens ?? value.prompt_tokens;
	const output =
		value.outputTokens ?? value.output_tokens ?? value.completion_tokens;
	if (typeof input !== "number" || typeof output !== "number") return undefined;
	const cost = value.cost;
	return {
		inputTokens: input,
		outputTokens: output,
		...(typeof cost === "number" && Number.isFinite(cost) ? { cost } : {}),
	};
}

async function post(
	url: string,
	spec: JudgeSpec,
	apiKey: string,
	body: unknown,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const sent = JSON.stringify(body);
	let wait = BACKOFF_MS;
	for (let attempt = 1; ; attempt += 1) {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${apiKey}`,
			},
			body: sent,
			signal,
		});
		if (response.ok) {
			const parsed: unknown = await response.json().catch(() => undefined);
			if (!isRecord(parsed))
				throw new Error(
					`${spec.label} answered with a body that is not an object`,
				);
			return parsed;
		}
		if (!RETRYABLE.has(response.status) || attempt === ATTEMPTS) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`${spec.label} answered ${response.status}: ${text.slice(0, ERROR_BODY_CHARS)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, wait));
		wait *= 2;
	}
}

function answersIn(
	questions: Readonly<Record<string, Question>>,
	answers: unknown,
	spec: JudgeSpec,
): Record<string, Answer> {
	if (!isRecord(answers))
		throw new Error(`${spec.label} answered without answers`);
	const out: Record<string, Answer> = {};
	for (const [what, question] of Object.entries(questions))
		out[what] = readAnswer(question, answers[what], spec.label, what);
	return out;
}

async function decisions(
	spec: JudgeSpec,
	apiKey: string,
	model: string,
	req: JudgeRequest,
	signal?: AbortSignal,
): Promise<Judged> {
	const reply = await post(
		`${spec.baseUrl}/alpha/decisions`,
		spec,
		apiKey,
		{ model, state: req.state, questions: req.questions },
		signal,
	);
	return {
		model: typeof reply.model === "string" ? reply.model : model,
		answers: answersIn(req.questions, reply.answers, spec),
		calibrated: true,
		usage: usageIn(reply.usage),
	};
}

function schemaFor(questions: Readonly<Record<string, Question>>): JsonValue {
	const properties: Record<string, JsonValue> = {};
	for (const [what, question] of Object.entries(questions)) {
		if (question.type === "noul") {
			properties[what] = { type: "number", minimum: 0, maximum: 1 };
			continue;
		}
		properties[what] =
			question.type === "choice"
				? { type: "string", enum: Object.keys(question.criteria) }
				: {
						type: "integer",
						minimum: 0,
						maximum: Math.max(0, question.criteria.length - 1),
					};
		properties[`${what}_confidence`] = {
			type: "number",
			minimum: 0,
			maximum: 1,
		};
	}
	return {
		type: "object",
		properties,
		required: Object.keys(properties),
		additionalProperties: false,
	};
}

function tokenDistribution(
	logprobs: unknown,
	keys: readonly string[],
): Record<string, number> | undefined {
	if (!isRecord(logprobs) || !Array.isArray(logprobs.content)) return undefined;
	for (const entry of logprobs.content as unknown[]) {
		if (!isRecord(entry) || !Array.isArray(entry.top_logprobs)) continue;
		const weights = new Map<string, number>();
		for (const top of entry.top_logprobs as unknown[]) {
			if (!isRecord(top)) continue;
			const token = typeof top.token === "string" ? top.token.trim() : "";
			if (!keys.includes(token)) continue;
			if (typeof top.logprob !== "number") continue;
			weights.set(
				token,
				Math.max(weights.get(token) ?? 0, Math.exp(top.logprob)),
			);
		}
		if (weights.size < 2) continue;
		const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
		if (total <= 0) continue;
		const out: Record<string, number> = {};
		for (const key of keys) out[key] = (weights.get(key) ?? 0) / total;
		return out;
	}
	return undefined;
}

function chatAnswers(
	questions: Readonly<Record<string, Question>>,
	written: Record<string, unknown>,
	logprobs: unknown,
	spec: JudgeSpec,
): Record<string, Answer> {
	const out: Record<string, Answer> = {};
	for (const [what, question] of Object.entries(questions)) {
		if (question.type === "noul") {
			out[what] = {
				type: "noul",
				noul: bounded(written[what], spec.label, what),
			};
			continue;
		}
		const confidence = bounded(written[`${what}_confidence`], spec.label, what);
		if (question.type === "choice") {
			const keys = Object.keys(question.criteria);
			const picked = written[what];
			if (typeof picked !== "string" || !keys.includes(picked))
				throw new Error(
					`${spec.label} answered ${what} with "${String(picked)}", which is not one of ${keys.join(", ")}`,
				);
			out[what] = {
				type: "choice",
				choice: picked,
				confidence,
				probabilities:
					tokenDistribution(logprobs, keys) ?? oneHot(keys, picked),
			};
			continue;
		}
		const levels = question.criteria.length;
		const picked = written[what];
		if (
			typeof picked !== "number" ||
			!Number.isInteger(picked) ||
			picked < 0 ||
			picked >= levels
		)
			throw new Error(
				`${spec.label} answered ${what} with "${String(picked)}", which is not a level between 0 and ${levels - 1}`,
			);
		const keys = question.criteria.map((_level, index) => String(index));
		out[what] = {
			type: "score",
			score: picked,
			confidence,
			legend: Object.fromEntries(
				question.criteria.map((level, index) => [String(index), level]),
			),
			probabilities:
				tokenDistribution(logprobs, keys) ?? oneHot(keys, String(picked)),
		};
	}
	return out;
}

async function chat(
	spec: JudgeSpec,
	apiKey: string,
	model: string,
	req: JudgeRequest,
	signal?: AbortSignal,
): Promise<Judged> {
	const reply = await post(
		`${spec.baseUrl}/chat/completions`,
		spec,
		apiKey,
		{
			model,
			temperature: 0,
			logprobs: true,
			top_logprobs: TOP_LOGPROBS,
			messages: [
				{ role: "system", content: CHAT_INSTRUCTIONS },
				{
					role: "user",
					content: JSON.stringify({
						state: req.state,
						questions: req.questions,
					}),
				},
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "judgment",
					strict: true,
					schema: schemaFor(req.questions),
				},
			},
		},
		signal,
	);
	const first = Array.isArray(reply.choices)
		? (reply.choices as unknown[])[0]
		: undefined;
	const message = isRecord(first) ? first.message : undefined;
	const content = isRecord(message) ? message.content : undefined;
	if (typeof content !== "string")
		throw new Error(`${spec.label} answered without a message`);
	let written: unknown;
	try {
		written = JSON.parse(content);
	} catch {
		throw new Error(`${spec.label} answered with something that is not JSON`);
	}
	if (!isRecord(written))
		throw new Error(
			`${spec.label} answered with a judgment that is not an object`,
		);
	return {
		model: typeof reply.model === "string" ? reply.model : model,
		answers: chatAnswers(
			req.questions,
			written,
			isRecord(first) ? first.logprobs : undefined,
			spec,
		),
		calibrated: false,
		usage: usageIn(reply.usage),
	};
}

export function defineJudge(spec: JudgeSpec): Judge {
	return async (req, signal) => {
		const { apiKey } = spec;
		if (apiKey === undefined)
			throw new Error(
				`${spec.apiKeyEnv} is not set — add it to your environment (.env) to talk to ${spec.label}.`,
			);
		const model = req.model ?? spec.defaultModel;
		return spec.protocol === "decisions"
			? await decisions(spec, apiKey, model, req, signal)
			: await chat(spec, apiKey, model, req, signal);
	};
}
