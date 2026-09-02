import {
	type Aim,
	BloubBot,
	DEFAULT_EXPRESSION,
	type ExpressionId,
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
	idle: { state: "idle", label: "the agent is idle" },
} satisfies Record<string, Mood>;

/**
 * The moods the avatar passes through, one per finished run. It always comes back
 * to `DEFAULT_EXPRESSION` — the pose measured off the video, eyes level and fully
 * open — and it always starts there.
 *
 * An expression only lands on a state wearing the resting face, so this is `idle`
 * and `busy` — everything else has a pose measured off the video, and that pose
 * IS the state.
 *
 * Note what actually distinguishes them here: the gaze is driven from outside, so
 * each expression's own yaw and pitch are overruled and what's left is the SHAPE
 * of its eyes — squinting, half-shut, level, small. Three of the five also carry
 * a roll (`confus` +8°, `mefiant` −6°, `timide` −7°), which tilts the head, so the
 * eyes slide a little vertically as the face morphs. That's why the package's own
 * set is roll-free; here it reads as the avatar shifting its weight, which is
 * worth the slide.
 */
const FACES: readonly ExpressionId[] = [
	"confus",
	"mefiant",
	"fier",
	"timide",
	"blase",
];

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
 * How long a mood is worn before the face relaxes. Chosen: long enough to be read
 * while the reply is, short enough that the avatar isn't still smirking at you an
 * hour later. A mood is a reaction, and a reaction ends.
 */
const MOOD_MS = 8000;

/**
 * The face the avatar wears at rest.
 *
 * A finished run puts on the next mood and hands it back after `MOOD_MS`; that is
 * what marks the end of a run now that there is no wink. Everything else — the
 * first paint, a cleared transcript — is the measured resting pose, so a
 * conversation always opens on the same face.
 */
function useRestingFace(isLoading: boolean, fresh: boolean): ExpressionId {
	const [face, setFace] = useState<ExpressionId>(DEFAULT_EXPRESSION);
	const next = useRef(0);
	const was = useRef(false);

	useEffect(() => {
		const finished = was.current && !isLoading;
		was.current = isLoading;
		if (!finished) return;
		setFace(FACES[next.current % FACES.length]);
		next.current += 1;
		const timer = setTimeout(() => setFace(DEFAULT_EXPRESSION), MOOD_MS);
		return () => clearTimeout(timer);
	}, [isLoading]);

	// `clear()` empties the transcript without remounting anything, so the reset
	// has to be watched for rather than left to the initial state.
	useEffect(() => {
		if (fresh) setFace(DEFAULT_EXPRESSION);
	}, [fresh]);

	return face;
}

export function AgentAvatar({ size = 28 }: { size?: number }) {
	const { messages, isLoading, error } = useChatSession();
	const face = useRestingFace(isLoading, messages.length === 0);

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
					expression={face}
					// half again as big: at 28px the video's own capsule is 1.7px wide and
					// four of these five moods are squints, so unscaled they read as
					// nothing. Measured for THIS list, resting face included, on `carre`
					// across the gaze envelope — clean at 1.5 and 1.6, while `neutre` and
					// `confus` leave the silhouette at 1.75. Changing `FACES` means
					// measuring again; the package only locks 1.3, which holds for all
					// sixteen expressions.
					eyeScale={1.5}
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
