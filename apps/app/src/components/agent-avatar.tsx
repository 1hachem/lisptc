import { BloubBot, type StateId } from "@repo/bloub";
import { useEffect, useRef, useState } from "react";
import { useChatSession } from "../lib/chat.tsx";

/**
 * The agent's face, at the foot of the transcript. It replaces the `…` that used
 * to mark a run in flight: the engine's `thinking` state IS three pulsing dots,
 * so the placeholder became the avatar rather than sitting next to it.
 *
 * It stays mounted whatever the agent is doing, and that is the point — the
 * engine morphs between states, so a change reads as one shape becoming another.
 * Mounting it per run would replace every transition with a cut.
 */

/** `wink`'s own measured duration: the beat it was drawn for. */
const WINK_MS = 1600;

interface Mood {
	state: StateId;
	/** a CSS variable, so the avatar follows `[data-theme]` like the rest of the UI */
	ink: string;
	label: string;
}

/**
 * Only body-and-eye states are used here. The engine's ring states (`orbit`,
 * `comet`, `play`) draw their strokes in viewBox units — 6 units of 316 — so at
 * 28px they come out under a pixel wide and read as nothing at all. Colour does
 * the work instead: at this size it is legible where an eye shape is not.
 *
 * `squircle` is the closest thing the shape catalogue has to a square, and it
 * only shows on the states the engine calls `baseBody` (`idle`, `wide`, `wink`).
 * On `thinking` and `alert` the silhouette IS the animation, so the avatar is
 * briefly not square — that's the engine's rule, not an oversight.
 */
const MOODS = {
	failed: { state: "alert", ink: "var(--red)", label: "the agent errored" },
	thinking: {
		state: "thinking",
		ink: "var(--yellow)",
		label: "the agent is thinking",
	},
	answering: {
		state: "wide",
		ink: "var(--fg)",
		label: "the agent is answering",
	},
	done: { state: "wink", ink: "var(--green)", label: "the agent is done" },
	idle: { state: "idle", ink: "var(--fg)", label: "the agent is idle" },
} satisfies Record<string, Mood>;

/**
 * A run that just finished gets one wink, held for the state's own duration and
 * not until the next event: the wink is a beat, not a status. Left up, it would
 * read as the agent still winking at you minutes after the reply landed.
 */
function useFinishedBeat(isLoading: boolean, failed: boolean): boolean {
	const [beat, setBeat] = useState(false);
	const was = useRef(false);

	useEffect(() => {
		const finished = was.current && !isLoading;
		was.current = isLoading;
		if (!finished || failed) return;
		setBeat(true);
		const timer = setTimeout(() => setBeat(false), WINK_MS);
		return () => clearTimeout(timer);
	}, [isLoading, failed]);

	return beat;
}

export function AgentAvatar({ size = 28 }: { size?: number }) {
	const { messages, isLoading, error } = useChatSession();
	const winking = useFinishedBeat(isLoading, Boolean(error));

	const last = messages[messages.length - 1];
	// No reply has started coming back yet, so the agent is still deciding: the
	// tool messages of a long run land here as `answering`, which is what they are.
	const awaitingFirstToken =
		isLoading && (!last || last.type === "human" || last.type === "user");

	const mood = error
		? "failed"
		: awaitingFirstToken
			? "thinking"
			: isLoading
				? "answering"
				: winking
					? "done"
					: "idle";
	const { state, ink, label } = MOODS[mood];

	return (
		<div className="select-none">
			{/*
			 * The label is a text node in a live region, not just the SVG's
			 * `aria-label`: a live region announces when its TEXT changes, and an
			 * attribute changing on a descendant image is not that. So the drawing
			 * is hidden and the state is spoken.
			 */}
			<span className="sr-only" aria-live="polite">
				{label}
			</span>
			<span aria-hidden="true">
				<BloubBot
					size={size}
					shape="squircle"
					state={state}
					ink={ink}
					// what the eye holes are cut out of
					paper="var(--bg)"
					ariaLabel={label}
				/>
			</span>
		</div>
	);
}
