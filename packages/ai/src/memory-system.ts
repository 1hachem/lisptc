import type { Area, Cue, Situation, Turn } from "@repo/shared/recognition";
import type { SystemOneModel, Verdict } from "@repo/shared/system-one";
import {
	AREA_LACKS,
	AREA_OPENS_AT,
	AREA_QUESTION,
	AREA_SHOWS,
	NONE_MEANS,
	NONE_OPTION,
	optionFor,
	PICK_QUESTION,
	PLATFORM,
} from "./prompts/recognition.ts";

export const RECOGNITION_TIMEOUT_MS = 2_000;

export type MemorySystem = (
	situation: Situation,
	cues: readonly Cue[],
	areas?: readonly Area[],
) => Promise<ReadonlyMap<string, number>>;

interface Latest {
	message?: string;
	code?: string;
	result?: string;
}

function latestOf(conversation: readonly Turn[]): {
	earlier: Turn[];
	latest: Latest;
} {
	let user = conversation.length - 1;
	while (user >= 0 && conversation[user]?.role !== "user") user--;
	let code = conversation.length - 1;
	while (code > user && conversation[code]?.role !== "assistant") code--;
	const stepped = code > user;
	const message = conversation[user]?.content;
	const result = stepped
		? conversation
				.slice(code + 1)
				.map((turn) => turn.content)
				.join("\n\n")
		: "";
	return {
		earlier: conversation.filter(
			(_, at) => at !== user && (stepped ? at < code : at < user),
		),
		latest: {
			...(message === undefined ? {} : { message }),
			...(stepped ? { code: conversation[code]?.content } : {}),
			...(result === "" ? {} : { result }),
		},
	};
}

const UNFILED = "";

function grouped(
	cues: readonly Cue[],
	areas: readonly Area[],
): Map<string, Cue[]> {
	const gated = new Set(areas.map((area) => area.name));
	const groups = new Map<string, Cue[]>();
	for (const cue of cues) {
		const name =
			cue.area !== undefined && gated.has(cue.area) ? cue.area : UNFILED;
		groups.set(name, [...(groups.get(name) ?? []), cue]);
	}
	return groups;
}

function answered(
	answers: Record<string, Verdict>,
	id: string,
	model: string,
	what: string,
): Verdict {
	const verdict = answers[id];
	if (verdict === undefined)
		throw new Error(`${model} left ${what} unanswered`);
	return verdict;
}

function picks(
	verdict: Verdict,
	members: readonly Cue[],
	model: string,
	name: string,
): Map<string, number> {
	if (verdict.type !== "choice")
		throw new Error(`${model} did not pick among the memories of "${name}"`);
	return new Map(
		members.map((cue) => [cue.key, verdict.probabilities[cue.key] ?? 0]),
	);
}

export function memorySystem(
	model: SystemOneModel,
	timeoutMs: number = RECOGNITION_TIMEOUT_MS,
): MemorySystem {
	return async (situation, cues, areas = []) => {
		const signal = AbortSignal.timeout(timeoutMs);
		const state = { platform: PLATFORM, ...latestOf(situation.conversation) };
		const gates = new Map(areas.map((area) => [area.name, area]));
		const settled = await Promise.allSettled(
			[...grouped(cues, areas)].map(async ([name, members]) => {
				const area = gates.get(name);
				const gate = area !== undefined && !area.open;
				const { answers } = await model.judge(
					{
						state,
						questions: {
							pick: {
								type: "choice",
								instructions: PICK_QUESTION,
								criteria: {
									...Object.fromEntries(
										members.map((cue) => [cue.key, optionFor(cue)]),
									),
									[NONE_OPTION]: NONE_MEANS,
								},
							},
							...(gate
								? {
										gate: {
											type: "noul",
											instructions: {
												question: AREA_QUESTION,
												area: { name, situation: area.situation },
											},
											criteria: { true: AREA_SHOWS, false: AREA_LACKS },
										},
									}
								: {}),
						},
					},
					signal,
				);
				const scored = picks(
					answered(answers, "pick", model.model, `the memories of "${name}"`),
					members,
					model.model,
					name,
				);
				if (!gate) return scored;
				const verdict = answered(
					answers,
					"gate",
					model.model,
					`area "${name}"`,
				);
				const opened = verdict.type === "noul" && verdict.noul >= AREA_OPENS_AT;
				return opened ? scored : new Map(members.map((cue) => [cue.key, 0]));
			}),
		);
		const judged = settled.flatMap((area) =>
			area.status === "fulfilled" ? [area.value] : [],
		);
		const failed = settled.find((area) => area.status === "rejected");
		if (judged.length === 0 && failed !== undefined) throw failed.reason;
		return new Map(judged.flatMap((scores) => [...scores]));
	};
}
