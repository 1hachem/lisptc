import type { SystemOneModel } from "@repo/shared/system-one";

export const RECOGNITION_TIMEOUT_MS = 2_000;

export interface Turn {
	readonly role: string;
	readonly content: string;
}

export interface Situation {
	readonly conversation: readonly Turn[];
}

export interface Cue {
	readonly key: string;
	readonly situation: string;
	readonly unless?: string;
	readonly gist: string;
}

export type MemorySystem = (
	situation: Situation,
	cues: readonly Cue[],
) => Promise<ReadonlyMap<string, number>>;

const PLATFORM =
	"An AI agent works for the user by writing lisptc, a Lisp, into a REPL. Each step the agent writes forms; `assistant` turns hold its code, `tool` turns hold what came back: a value, printed output, or an error such as `undefined: name`. Prose around forms is ignored. `system` turns are events from the platform. A memory is a note that loads into the agent's context when its situation arises, so it can act right on its next step.";

const RECOGNITION =
	"Does the situation in `situation` hold in `latest`, the user's current message and the agent's last step, so that the memory in `memory` helps the agent's next step? `earlier` is context only: a situation that held only there is over.";

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

export function memorySystem(
	model: SystemOneModel,
	timeoutMs: number = RECOGNITION_TIMEOUT_MS,
): MemorySystem {
	return async (situation, cues) => {
		const ids = cues.map((_, i) => `m${i}`);
		const { answers } = await model.judge(
			{
				state: { platform: PLATFORM, ...latestOf(situation.conversation) },
				questions: Object.fromEntries(
					cues.map((cue, i) => [
						ids[i],
						{
							type: "noul",
							instructions: {
								question: RECOGNITION,
								situation: cue.situation,
								...(cue.unless === undefined ? {} : { unless: cue.unless }),
								memory: { key: cue.key, teaches: cue.gist },
							},
							criteria: {
								true: "`latest` shows the situation: the user asks for it, the agent is doing it or about to, or the result or error it describes just came back",
								false: `the situation is absent from \`latest\`, held only in \`earlier\`${cue.unless === undefined ? "" : ", or the look-alike in `unless` holds instead"}`,
							},
						},
					]),
				),
			},
			AbortSignal.timeout(timeoutMs),
		);
		return new Map(
			cues.map((cue, i) => {
				const verdict = answers[ids[i] as string];
				if (verdict?.type !== "noul")
					throw new Error(`${model.model} left "${cue.key}" unanswered`);
				return [cue.key, verdict.noul];
			}),
		);
	};
}
