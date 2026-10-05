import { type SystemEventTicket, systemEventTicket } from "./system-event.ts";
import { postUiAction } from "./ui-action.ts";

const ASKS_KEY = "asks";

export interface AskChoice {
	readonly label: string;
	readonly done: string;
	readonly accepts: boolean;
	readonly answer: {
		readonly action: string;
		readonly values: Record<string, string | boolean>;
	};
	readonly opens?: string;
	readonly primary?: true;
}

export interface Ask {
	readonly id: string;
	readonly title: string;
	readonly detail?: string;
	readonly prompt: string;
	readonly choices: readonly AskChoice[];
}

export interface Answered {
	readonly accepted: boolean;
	readonly label: string;
}

export type AskOutcome =
	| { readonly ok: true; readonly event?: SystemEventTicket }
	| { readonly ok: false; readonly error: string };

export interface AskTransport {
	answer(
		chatId: string | null,
		messageId: string | undefined,
		choice: AskChoice,
	): Promise<AskOutcome>;
}

export const uiActionTransport: AskTransport = {
	async answer(chatId, messageId, { answer }) {
		const result = await postUiAction(
			chatId,
			answer.action,
			answer.values,
			messageId,
		);
		if (!result.live)
			return { ok: false, error: "this session is no longer live" };
		const { error, output } = result.response;
		if (error) return { ok: false, error: output || "the answer was refused" };
		const event = systemEventTicket(result.response.event);
		return event === undefined ? { ok: true } : { ok: true, event };
	},
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function asksOf(kwargs: Record<string, unknown> | undefined): Ask[] {
	const open = record(kwargs?.[ASKS_KEY])?.open;
	return Array.isArray(open) ? open.flatMap(askOf) : [];
}

export function answersOf(
	kwargs: Record<string, unknown> | undefined,
): ReadonlyMap<string, Answered> {
	const answers = new Map<string, Answered>();
	const answered = record(record(kwargs?.[ASKS_KEY])?.answered);
	for (const [id, value] of Object.entries(answered ?? {})) {
		const { accepted, label } = record(value) ?? {};
		if (typeof accepted === "boolean" && typeof label === "string")
			answers.set(id, { accepted, label });
	}
	return answers;
}

export function withAnswer(
	kwargs: Record<string, unknown> | undefined,
	id: string,
	answer: Answered,
): Record<string, unknown> {
	const asks = record(kwargs?.[ASKS_KEY]) ?? {};
	return {
		...kwargs,
		[ASKS_KEY]: {
			...asks,
			answered: { ...record(asks.answered), [id]: answer },
		},
	};
}

function askOf(value: unknown): Ask[] {
	const { id, title, detail, prompt, choices } = record(value) ?? {};
	if (
		typeof id !== "string" ||
		typeof title !== "string" ||
		typeof prompt !== "string" ||
		!Array.isArray(choices)
	)
		return [];
	return [
		{
			id,
			title,
			...(typeof detail === "string" && detail ? { detail } : {}),
			prompt,
			choices: choices.flatMap(choiceOf),
		},
	];
}

function choiceOf(value: unknown): AskChoice[] {
	const { label, done, accepts, answer, opens, primary } = record(value) ?? {};
	const { action, values } = record(answer) ?? {};
	if (
		typeof label !== "string" ||
		typeof accepts !== "boolean" ||
		typeof action !== "string"
	)
		return [];
	const given = Object.entries(record(values) ?? {}).filter(
		(entry): entry is [string, string | boolean] =>
			typeof entry[1] === "string" || typeof entry[1] === "boolean",
	);
	return [
		{
			label,
			done: typeof done === "string" ? done : label,
			accepts,
			answer: { action, values: Object.fromEntries(given) },
			...(typeof opens === "string" ? { opens } : {}),
			...(primary === true ? { primary } : {}),
		},
	];
}
