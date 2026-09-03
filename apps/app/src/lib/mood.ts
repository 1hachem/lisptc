import type { StateId } from "@repo/bloub";
import { useChatSession } from "./chat.tsx";

/**
 * What the agent is doing, as one of the engine's states.
 *
 * Read in two places — the avatar at the foot of the transcript
 * (`components/agent-avatar.tsx`) and the tab icon
 * (`components/animated-favicon.tsx`) — which is why it lives here rather than
 * in either of them: the two are the same face and they must never disagree
 * about what it is doing.
 */

interface Mood {
	state: StateId;
	label: string;
}

/**
 * One ink for every state, so the shape alone carries the status. That rules out
 * the engine's ring states (`orbit`, `comet`, `play`): they draw their strokes in
 * viewBox units — 6 of 316 — so at 28px they come out under a pixel wide and read
 * as nothing at all, and the 16px of a tab has it worse. Bodies, eyes and dots
 * are what's left.
 *
 * `busy` and `idle` share a state on purpose: while the reply streams, the only
 * thing that changes is where the avatar looks (see `UPWARD` in the avatar).
 *
 * The engine ships two exclamation marks and `failed` takes the UPRIGHT one.
 * `exclaim` is its own measured silhouette — a bar tapering 1.76 : 1 from top to
 * bottom, held still. `alert` is the other: a constant-width capsule leaning
 * 17.7°, travelling across the frame and buzzing at 2.5 Hz. Standing that one up
 * would give a uniform bar, since its width was measured for a lean, so this is a
 * choice between two glyphs rather than an angle to zero out.
 */
const MOODS = {
	failed: { state: "exclaim", label: "the agent errored" },
	thinking: { state: "thinking", label: "the agent is thinking" },
	busy: { state: "idle", label: "the agent is answering" },
	idle: { state: "idle", label: "the agent is idle" },
} satisfies Record<string, Mood>;

export type MoodId = keyof typeof MOODS;

export function useAgentMood(): Mood & { mood: MoodId } {
	const { messages, isLoading, error } = useChatSession();

	// Nothing has come back yet, so the agent is still deciding. Once anything
	// has — a chunk of the reply, or a tool turn — the run is answering.
	const last = messages[messages.length - 1];
	const deciding =
		isLoading && (!last || last.type === "human" || last.type === "user");

	const mood: MoodId = error
		? "failed"
		: deciding
			? "thinking"
			: isLoading
				? "busy"
				: "idle";

	return { mood, ...MOODS[mood] };
}
