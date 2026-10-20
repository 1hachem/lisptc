import { readAnnotation } from "@repo/interpreter/annotations";
import {
	type Answered,
	type Ask,
	type AskChoice,
	answering,
	asksKey,
} from "@repo/interpreter/asks";
import { type SystemEventTicket, systemEventTicket } from "./system-event.ts";
import { postUiAction } from "./ui-action.ts";

export type { Answered, Ask, AskChoice };

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

export function asksOf(kwargs: Record<string, unknown> | undefined): Ask[] {
	return [...(readAnnotation(kwargs, asksKey)?.open ?? [])];
}

export function answersOf(
	kwargs: Record<string, unknown> | undefined,
): ReadonlyMap<string, Answered> {
	return new Map(
		Object.entries(readAnnotation(kwargs, asksKey)?.answered ?? {}),
	);
}

export function withAnswer(
	kwargs: Record<string, unknown> | undefined,
	id: string,
	answer: Answered,
): Record<string, unknown> {
	return {
		...kwargs,
		[asksKey.name]: answering(readAnnotation(kwargs, asksKey), id, answer),
	};
}
