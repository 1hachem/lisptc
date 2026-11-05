import type { SystemOneModel } from "@repo/shared/system-one";

export const APPLIES_TIMEOUT_MS = 2_000;

export interface Situation {
	readonly message: string;
	readonly step?: string;
}

export type AppliesJudge = (
	situation: Situation,
	descriptions: readonly string[],
) => Promise<ReadonlyMap<string, number>>;

export function appliesJudge(
	model: SystemOneModel,
	timeoutMs: number = APPLIES_TIMEOUT_MS,
): AppliesJudge {
	return async (situation, descriptions) => {
		const ids = descriptions.map((_, i) => `d${i}`);
		const { answers } = await model.judge(
			{
				state: situation,
				questions: Object.fromEntries(
					descriptions.map((applies, i) => [
						ids[i],
						{
							type: "noul",
							instructions: `Does the situation, the user's \`message\` and, when present, the agent's latest \`step\` with what came of it, call for knowledge that applies when: ${applies}?`,
							criteria: {
								true: "the user is asking for this, or the agent is about to need it to help them",
								false: "the situation is about something else",
							},
						},
					]),
				),
			},
			AbortSignal.timeout(timeoutMs),
		);
		return new Map(
			descriptions.map((applies, i) => {
				const verdict = answers[ids[i] as string];
				if (verdict?.type !== "noul")
					throw new Error(`${model.model} left "${applies}" unanswered`);
				return [applies, verdict.noul];
			}),
		);
	};
}
