import { type Question, questionKind } from "@repo/journal-catalog/intent";
import { latest } from "@repo/shared/journal";
import { type EntryCarrier, entriesOfMessage } from "./entries.ts";

export function openQuestion(
	messages: readonly EntryCarrier[],
): Question | undefined {
	for (let at = messages.length - 1; at >= 0; at--) {
		const message = messages[at];
		if (message === undefined || message.type === "human") return undefined;
		const question = latest(entriesOfMessage(message), questionKind);
		if (question !== undefined) return question;
	}
	return undefined;
}

export function answerOf(
	question: Question,
	chosen: readonly number[],
): string {
	return chosen
		.map((at) => question.choices[at])
		.filter((choice) => choice !== undefined)
		.join(", ");
}

export function questionText(question: Question): string {
	const pick = question.multi ? "pick several" : "pick one";
	return `${question.prompt}\n${pick}: ${question.choices.join(" · ")}`;
}
