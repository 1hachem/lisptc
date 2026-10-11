import {
	ASKS_KEY,
	type Ask,
	type AskChoice,
	type Asks,
} from "@repo/interpreter/asks";
import type { StepAnnotations } from "@repo/interpreter/session";

export function openAsks(annotations: StepAnnotations): readonly Ask[] {
	return ((annotations.output[ASKS_KEY] ?? {}) as Asks).open ?? [];
}

export function question(ask: Ask): string {
	const detail = ask.detail ? ` ${ask.detail}` : "";
	return `${ask.title}${detail}: ${ask.prompt} [y/N] `;
}

export function yesOrNo(ask: Ask, reply: string): AskChoice | undefined {
	if (!/^y(es)?$/i.test(reply.trim()))
		return ask.choices.find((c) => !c.accepts);
	return (
		ask.choices.find((c) => c.accepts && c.primary) ??
		ask.choices.find((c) => c.accepts)
	);
}

export interface AskingStep {
	run(): Promise<readonly Ask[]>;
	reply(ask: Ask): Promise<string | null>;
	answer(choice: AskChoice): Promise<void>;
}

export async function runAsking(step: AskingStep): Promise<string[]> {
	for (;;) {
		const asks = await step.run();
		if (asks.length === 0) return [];
		const told: string[] = [];
		let refused = false;
		let rerun = false;
		for (const ask of asks) {
			const choice = yesOrNo(ask, (await step.reply(ask)) ?? "");
			if (choice === undefined) {
				told.push(`${ask.title}: left unanswered`);
				refused = true;
				continue;
			}
			await step.answer(choice);
			if (!choice.accepts || ask.answerApplies)
				told.push(`${ask.title}: ${choice.done}`);
			if (!choice.accepts) refused = true;
			else if (!ask.answerApplies) rerun = true;
		}
		if (refused || !rerun) return told;
	}
}
