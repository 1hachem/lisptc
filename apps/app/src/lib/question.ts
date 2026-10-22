import {
	type Question,
	questionKey,
	readAnnotation,
} from "@repo/interpreter/annotations";

export interface QuestionCarrier {
	type: string;
	additional_kwargs?: Record<string, unknown>;
}

export function openQuestion(
	messages: readonly QuestionCarrier[],
): Question | undefined {
	for (let at = messages.length - 1; at >= 0; at--) {
		const message = messages[at];
		if (message === undefined || message.type === "human") return undefined;
		if (message.type !== "tool") continue;
		const question = readAnnotation(message.additional_kwargs, questionKey);
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
