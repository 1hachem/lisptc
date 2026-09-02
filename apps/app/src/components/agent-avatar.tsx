import {
	type Aim,
	BloubBot,
	type GazeScript,
	type Look,
	PITCH_MAX,
	type StateId,
	YAW_MAX,
} from "@repo/bloub";
import { useEffect, useRef, useState } from "react";
import { useChatSession } from "../lib/chat.tsx";

/**
 * The agent's face, at the foot of the transcript, in place of the `…` that used
 * to mark a run in flight.
 *
 * It stays mounted whatever the agent is doing, and that is the point — the
 * engine morphs between states, so a change reads as one shape becoming another.
 * Mounting it per run would replace every transition with a cut, and the dots of
 * `thinking` are the clearest case: the body itself becomes the middle dot.
 */

/** `wink`'s own measured duration: the beat it was drawn for. */
const WINK_MS = 1600;

interface Mood {
	state: StateId;
	label: string;
}

/**
 * One ink for every state, so the shape alone carries the status. That rules out
 * the engine's ring states (`orbit`, `comet`, `play`): they draw their strokes in
 * viewBox units — 6 of 316 — so at 28px they come out under a pixel wide and read
 * as nothing at all. Bodies, eyes and dots are what's left.
 *
 * `busy` and `idle` share a state on purpose: while the reply streams, the only
 * thing that changes is where the avatar looks (see `UPWARD`).
 */
const MOODS = {
	failed: { state: "alert", label: "the agent errored" },
	thinking: { state: "thinking", label: "the agent is thinking" },
	busy: { state: "idle", label: "the agent is answering" },
	done: { state: "wink", label: "the agent is done" },
	idle: { state: "idle", label: "the agent is idle" },
} satisfies Record<string, Mood>;

/**
 * Where the eyes go while the agent is idle: at the pointer, and straight ahead
 * when there is none.
 *
 * The package's own rule stages a view opening — it parks the head 26° to the
 * LEFT and spins the eyes a full turn on arrival — which is not what a status
 * icon in a transcript does. `mix: 1` hands the direction over entirely, and
 * `spin: 0` keeps the eyes on the front of the body: they are stuck to the real
 * outline, so sending them around the limb of a square would make them stutter
 * along the profile.
 *
 * Centred on the equator rather than on the package's `PITCH`: straight ahead is
 * the point, and the pointer moves it either way from there. Both amplitudes are
 * inside the envelope `skins.test.ts` locks for `carre`.
 */
function ahead({ nx, ny, pointer }: Aim): Look {
	return {
		yaw: nx * YAW_MAX,
		// a positive pitch looks up, where the screen's y goes down
		pitch: -ny * PITCH_MAX,
		mix: 1,
		spin: 0,
		// no pointer: hand the drift back, or the bot stares at a dead point
		wander: pointer ? 0 : 1,
	};
}

/**
 * While the reply streams the text is being written ABOVE the avatar, so it
 * watches it arrive.
 *
 * 26° is chosen, not measured, and it is the top of the envelope the package
 * locks for this shape — the pitch where the other silhouettes start letting an
 * eye out. `wander: 1` keeps the resting drift on top, so looking up is a live
 * pose rather than a frozen one.
 *
 * It goes through `gaze` and not through `aim` because the engine only steers the
 * gaze of a state wearing the resting face, and because the two are exclusive:
 * `follow` wins, so it is off while busy.
 */
const UPWARD: GazeScript = () => ({
	yaw: 0,
	pitch: 26,
	mix: 1,
	spin: 0,
	wander: 1,
});

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

	// Nothing has come back yet, so the agent is still deciding. Once anything
	// has — a chunk of the reply, or a tool turn — the run is answering.
	const last = messages[messages.length - 1];
	const deciding =
		isLoading && (!last || last.type === "human" || last.type === "user");

	const mood = error
		? "failed"
		: deciding
			? "thinking"
			: isLoading
				? "busy"
				: winking
					? "done"
					: "idle";
	const { state, label } = MOODS[mood];

	return (
		<div className="select-none">
			{/*
			 * The label is a text node in a live region, not just the SVG's
			 * `aria-label`: a live region announces when its TEXT changes, and an
			 * attribute changing on a descendant image is not that. So the drawing is
			 * hidden and the state is spoken.
			 */}
			<span className="sr-only" aria-live="polite">
				{label}
			</span>
			<span aria-hidden="true">
				<BloubBot
					size={size}
					shape="carre"
					// the catalogue's widest eyes, and they only land on the states wearing
					// the resting face — `idle`, which is where we want them
					expression="surpris"
					state={state}
					follow={mood === "idle"}
					aim={ahead}
					gaze={mood === "busy" ? UPWARD : null}
					ink="var(--fg)"
					// what the eye holes are cut out of
					paper="var(--bg)"
					ariaLabel={label}
				/>
			</span>
		</div>
	);
}
