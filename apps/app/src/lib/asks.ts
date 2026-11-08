import {
	type Answered,
	type Ask,
	type AskChoice,
	answering,
	asksKind,
} from "@repo/journal-catalog/asks";
import { postUiAction } from "./ui-action.ts";

export type AskOutcome =
	| { readonly ok: true }
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
		const { error, output } = await postUiAction(
			chatId,
			answer.action,
			answer.values,
			messageId,
		);
		if (error) return { ok: false, error: output || "the answer was refused" };
		return { ok: true };
	},
};

export function answerEntry(
	about: string,
	id: string,
	answer: Answered,
): Record<string, unknown> {
	return { kind: asksKind.name, value: answering(id, answer), about };
}

export function askText(ask: Ask, answered: Answered | undefined): string {
	return [
		ask.title,
		ask.detail,
		ask.prompt,
		`choices: ${ask.choices.map((choice) => choice.label).join(" · ")}`,
		answered === undefined ? "not answered" : `answered: ${answered.label}`,
	]
		.filter((line) => line !== undefined && line !== "")
		.join("\n");
}
