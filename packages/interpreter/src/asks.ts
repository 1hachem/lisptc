import { annotating, type StepAnnotations } from "./session.ts";

export const ASKS_KEY = "asks";

export interface AskAnswer {
	readonly action: string;
	readonly values: Readonly<Record<string, string | boolean>>;
}

export interface AskChoice {
	readonly label: string;
	readonly done: string;
	readonly accepts: boolean;
	readonly answer: AskAnswer;
	readonly opens?: string;
	readonly primary?: true;
}

export interface Ask {
	readonly id: string;
	readonly title: string;
	readonly detail?: string;
	readonly prompt: string;
	readonly choices: readonly AskChoice[];
	readonly answerApplies?: true;
}

export interface Answered {
	readonly accepted: boolean;
	readonly label: string;
}

export interface Asks {
	readonly open?: readonly Ask[];
	readonly answered?: Readonly<Record<string, Answered>>;
}

export function asking(into: StepAnnotations, add: Asks): StepAnnotations {
	const open = add.open ?? [];
	const answered = add.answered ?? {};
	if (open.length === 0 && Object.keys(answered).length === 0) return into;
	const held = (into.output[ASKS_KEY] ?? {}) as Asks;
	const merged: Asks = {
		...(open.length > 0 || held.open
			? { open: [...(held.open ?? []), ...open] }
			: {}),
		...(Object.keys(answered).length > 0 || held.answered
			? { answered: { ...held.answered, ...answered } }
			: {}),
	};
	return annotating(into, "output", { [ASKS_KEY]: merged });
}
