import type { SystemOneProvider } from "./system-one.ts";

export const APPLIES_TIMEOUT_MS = 800;

export type AppliesJudge = (
	message: string,
	descriptions: readonly string[],
) => Promise<ReadonlyMap<string, number>>;

export function appliesJudge(
	provider: SystemOneProvider,
	timeoutMs: number = APPLIES_TIMEOUT_MS,
): AppliesJudge {
	return async (message, descriptions) => {
		const ids = descriptions.map((_, i) => `d${i}`);
		const { answers } = await provider.decide({
			state: { message },
			questions: Object.fromEntries(
				descriptions.map((applies, i) => [
					ids[i],
					{
						type: "noul",
						instructions: `Does \`message\` call for knowledge that applies when: ${applies}?`,
						criteria: {
							true: "the user is asking for this, or is about to need it to be helped",
							false: "the message is about something else",
						},
					},
				]),
			),
			signal: AbortSignal.timeout(timeoutMs),
		});
		return new Map(
			descriptions.map((applies, i) => [
				applies,
				answers[ids[i] as string].noul,
			]),
		);
	};
}
