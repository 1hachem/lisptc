import {
	type Aim,
	BloubBot,
	type ExpressionId,
	type GazeScript,
	type Look,
	PITCH_MAX,
	type StateId,
	YAW_MAX,
} from "@repo/bloub";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Reaction, useChatSession } from "../lib/chat.tsx";

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

/**
 * The face the avatar wears when nothing is happening, and the one a conversation
 * opens on.
 *
 * `surpris` and not the video's own resting pose: that one is a pair of narrow
 * ovals, 0.19 of the body wide against 0.41 tall, which at icon size reads as two
 * slits. `surpris` is the roundest of the sixteen — 0.45 by 0.47, so very nearly
 * a circle — and it is one of the few with no roll, so the face doesn't sit
 * tilted at rest.
 */
const REST_FACE: ExpressionId = "surpris";

/**
 * The moods the avatar passes through, one per finished run. It always comes back
 * to `REST_FACE`, and it always starts there.
 *
 * An expression only lands on a state wearing the resting face, so this is `idle`
 * and `busy` — everything else has a pose measured off the video, and that pose
 * IS the state.
 *
 * All three are SYMMETRIC, and that is the selection rule rather than a matter of
 * taste. `confus` and `mefiant` were here and are not any more: both carry one eye
 * measured nearly shut — 0.17 and 0.15 of the body tall against the other's 0.44
 * and 0.40 — so landing on one at the end of a run read as a wink, which is the
 * one beat this avatar is not supposed to have.
 *
 * What distinguishes what's left: the gaze is driven from outside, so each
 * expression's own yaw and pitch are overruled and the SHAPE of its eyes is what
 * carries it — narrow and level, small, flat. Only `timide` still has a roll
 * (−7°), which tilts the head, so the eyes slide slightly as that face morphs in.
 */
const FACES: readonly ExpressionId[] = ["fier", "timide", "blase"];

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
 * While the reply streams the text is being written above the avatar and to its
 * RIGHT — the face stands at the left edge of the column, under the turn it is
 * answering, and that turn runs rightwards from directly overhead. Straight up
 * is one word of it; up and right is the paragraph.
 *
 * `YAW_MAX` is the full amplitude the pointer-following uses, and 26° of pitch is
 * chosen: together they aim about 31° off vertical, and both sit inside the
 * envelope `skins.test.ts` locks for this shape at this eye scale. `wander: 1`
 * keeps the resting drift on top, so looking up is a live pose and not a frozen
 * one.
 *
 * It goes through `gaze` and not through `aim` because the engine only steers the
 * gaze of a state wearing the resting face, and because the two are exclusive:
 * `follow` wins, so it is off while busy.
 */
const UPWARD: GazeScript = () => ({
	yaw: YAW_MAX,
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
 * first paint, a cleared transcript — is `REST_FACE`, so a conversation always
 * opens on the same face.
 */
function useRestingFace(
	isLoading: boolean,
	fresh: boolean,
	reaction: Reaction | null,
): ExpressionId {
	const [face, setFace] = useState<ExpressionId>(REST_FACE);
	const next = useRef(0);
	const was = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// A finished run and a vote both put a face on for a while, and a vote
	// usually arrives while the run's own mood is still being worn. One timer
	// between them, so whichever came last owns when the face comes off.
	const wear = useCallback((expression: ExpressionId) => {
		setFace(expression);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setFace(REST_FACE), MOOD_MS);
	}, []);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	useEffect(() => {
		const finished = was.current && !isLoading;
		was.current = isLoading;
		if (!finished) return;
		wear(FACES[next.current % FACES.length]);
		next.current += 1;
	}, [isLoading, wear]);

	// An expression handed to the agent is worn as it came, any of the engine's
	// sixteen, instead of the next face in the rotation: it was asked for, and
	// the rotation is only what the agent does when nobody asked. The caller
	// picks from the same vocabulary this file does, so there is no set of moods
	// in between to keep in step (see `Reaction`).
	//
	// One constraint travels with it: the engine lands an expression only on a
	// state that wears the resting face, so `idle` and `busy` show it and
	// `thinking` and `failed` keep their own measured pose.
	useEffect(() => {
		if (reaction) wear(reaction.expression);
	}, [reaction, wear]);

	// `clear()` empties the transcript without remounting anything, so the reset
	// has to be watched for rather than left to the initial state.
	useEffect(() => {
		if (fresh) setFace(REST_FACE);
	}, [fresh]);

	return face;
}

export function AgentAvatar({ size = 28 }: { size?: number }) {
	const { messages, isLoading, error, fresh, reaction } = useChatSession();
	const face = useRestingFace(isLoading, fresh, reaction);

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
					// grown a third: at 28px the video's own capsule is 1.7px wide, and two
					// of the three moods are squints. This is exactly the ceiling the package
					// locks — measured across the gaze envelope for all sixteen expressions,
					// and it is `surpris`, the widest and now the resting face, that sets
					// it: at 1.45 the two eyes meet and leave the silhouette. It read 1.3
					// until the package started measuring an eye's outline at constant arc
					// length, which is what finally caught `surpris` leaving the square by
					// 4.3 units of 100 at that scale.
					eyeScale={1.29}
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
