import {
	type Aim,
	BloubBot,
	type ExpressionId,
	type GazeScript,
	type Look,
	PITCH_MAX,
	YAW_MAX,
} from "@repo/bloub";
import { Typewriter } from "@repo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Reaction, useChatSession } from "../lib/chat.tsx";
import { useAgentMood } from "../lib/mood.ts";
import { usePrefersReducedMotion } from "../lib/motion.ts";
import {
	pickBusyPoke,
	pickDoublePoke,
	pickEnoughPoke,
	pickHoverPoke,
	type Poke,
	pickPoke,
} from "../lib/poke.ts";

/**
 * The agent's face, at the foot of the transcript, in place of the `…` that used
 * to mark a run in flight.
 *
 * It stays mounted whatever the agent is doing, and that is the point — the
 * engine morphs between states, so a change reads as one shape becoming another.
 * Mounting it per run would replace every transition with a cut, and the dots of
 * `thinking` are the clearest case: the body itself becomes the middle dot.
 */

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

/**
 * How long a poked line stays up after it has finished arriving. Chosen: long
 * enough to read twice, short enough that the bot isn't still complaining about a
 * poke you have forgotten giving it.
 */
const POKE_HOLD_MS = 4000;

/**
 * The line the agent is muttering, and the poke that puts one there.
 *
 * `at` is the click it belongs to and not the line itself: poking twice can draw
 * the same line, and the typewriter restarts on a change of `text` — so without
 * an identity of its own, a repeat would sit there already finished. It is also
 * what the hold timer is keyed on.
 */
interface Muttering {
	line: string;
	at: number;
}

/**
 * Under this much between two pokes, the second one is a double click and gets
 * answered as one.
 *
 * Counted here rather than taken from `onDoubleClick`, for two reasons. A native
 * double click arrives AFTER the two clicks that make it up, so the second click
 * would draw a line from the pool and have it replaced a frame later — a flicker
 * of a line nobody was meant to read. And `dblclick` is a pointer event, where a
 * button on a keyboard is worth the same as a button under a mouse: two quick
 * presses of Enter start the same fight.
 */
const DOUBLE_MS = 400;

/**
 * Two pokes further apart than this are two pokes; closer, and they are the same
 * burst of one. Deliberately much longer than `DOUBLE_MS` — steady prodding once
 * a second is still prodding, and the burst is what `BURST_LIMIT` counts.
 */
const BURST_MS = 1500;

/**
 * How many pokes into a burst the bot gives up. The count includes this one, so
 * the sixth poke is answered with a `-_-` and everything after it, until you stop
 * for `BURST_MS`, with nothing at all.
 *
 * Silence is the point and it is not a missing feature: a line for every click in
 * a mash is a line nobody reads, and a bot that keeps gamely answering a hundred
 * of them has no dignity. It goes quiet, which is what you would do.
 */
const BURST_LIMIT = 6;

/**
 * How long a cursor has to sit on the face before the bot mentions it. Long
 * enough that crossing the avatar on the way somewhere else never triggers it,
 * and that a cursor left there has plainly been left there.
 */
const HOVER_MS = 2500;

function usePoke(react: (expression: ExpressionId) => void, working: boolean) {
	const [muttering, setMuttering] = useState<Muttering | null>(null);
	const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastAt = useRef(0);
	/** pokes in the current burst, this one included */
	const burst = useRef(0);
	const linger = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (hold.current) clearTimeout(hold.current);
			if (linger.current) clearTimeout(linger.current);
		},
		[],
	);

	const say = useCallback(
		({ line, face }: Poke) => {
			if (hold.current) clearTimeout(hold.current);
			setMuttering({ line, at: Date.now() });
			// Same channel a thumbs-up goes through, so the face and the line are one
			// reaction rather than two. The engine only lands an expression on a state
			// wearing the resting face, so while the agent is still deciding — the one
			// state that owns the whole drawing — the line goes out on its own.
			react(face);
		},
		[react],
	);

	const poke = useCallback(() => {
		const at = Date.now();
		const gap = at - lastAt.current;
		const doubled = gap < DOUBLE_MS;
		burst.current = gap < BURST_MS ? burst.current + 1 : 1;
		lastAt.current = at;

		// Past the limit the bot has already said its last word on the subject, and
		// saying it again per click would undo the point of it.
		if (burst.current > BURST_LIMIT) return;

		/*
		 * Which pool, in order of who outranks whom: the end of a burst is the end of
		 * the exchange, a double click is deliberate, a poke during a run is an
		 * interruption, and anything else is just a poke.
		 * The line already up is dropped from every draw, so mashing reads as a
		 * repeated joke rather than a broken button (see `poke.ts`).
		 */
		const pick =
			burst.current === BURST_LIMIT
				? pickEnoughPoke
				: doubled
					? pickDoublePoke
					: working
						? pickBusyPoke
						: pickPoke;
		say(pick(Math.random(), muttering?.line));
	}, [say, working, muttering?.line]);

	return {
		muttering,
		poke,
		/**
		 * Hovering is its own line, and it is armed on ENTER rather than checked on a
		 * clock: only a mouse or a pen can hover, and a touch that reports itself as
		 * one would otherwise leave the bot complaining about a cursor nobody has.
		 *
		 * Fires once per hover. A cursor being used to poke is not lingering, so if a
		 * click landed while the timer ran it waits another round instead — which is
		 * what keeps a mash from being interrupted by a complaint about the pointer.
		 */
		hover: useCallback(
			(kind: string) => {
				if (kind === "touch") return;
				if (linger.current) clearTimeout(linger.current);
				linger.current = setTimeout(function fire() {
					if (Date.now() - lastAt.current < HOVER_MS) {
						linger.current = setTimeout(fire, HOVER_MS);
						return;
					}
					linger.current = null;
					say(pickHoverPoke(Math.random(), muttering?.line));
				}, HOVER_MS);
			},
			[say, muttering?.line],
		),
		unhover: useCallback(() => {
			if (linger.current) clearTimeout(linger.current);
			linger.current = null;
		}, []),
		/** the line has arrived in full — now it can start timing out */
		hide: useCallback(() => {
			if (hold.current) clearTimeout(hold.current);
			hold.current = setTimeout(() => setMuttering(null), POKE_HOLD_MS);
		}, []),
	};
}

export function AgentAvatar({ size = 28 }: { size?: number }) {
	const { isLoading, fresh, reaction, react } = useChatSession();
	const face = useRestingFace(isLoading, fresh, reaction);
	const { mood, state, label } = useAgentMood();
	const reduced = usePrefersReducedMotion();
	// `isLoading` is the whole run: deciding, and the reply streaming after it
	const { muttering, poke, hover, unhover, hide } = usePoke(react, isLoading);

	return (
		<div className="flex select-none items-center gap-2">
			{/*
			 * The label is a text node in a live region, not just the SVG's
			 * `aria-label`: a live region announces when its TEXT changes, and an
			 * attribute changing on a descendant image is not that. So the drawing is
			 * hidden and the state is spoken.
			 */}
			<span className="sr-only" aria-live="polite">
				{label}
			</span>
			{/* a real button, so the face answers a keyboard as well as a pointer */}
			<button
				type="button"
				aria-label="poke the agent"
				onClick={poke}
				onPointerEnter={(event) => hover(event.pointerType)}
				onPointerLeave={unhover}
				className="cursor-pointer leading-none"
			>
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
			</button>
			{muttering && (
				<>
					{/*
					 * Spoken whole, in its own live region, while the visible copy is
					 * hidden: a live region announces every change to its text, so
					 * leaving the reveal in it would read the line out one token at a
					 * time.
					 */}
					<span className="sr-only" aria-live="polite">
						{muttering.line}
					</span>
					<span aria-hidden="true" className="min-w-0 break-words text-dim">
						<Typewriter
							key={muttering.at}
							text={muttering.line}
							reveal="token"
							enabled={!reduced}
							onDone={hide}
						/>
					</span>
				</>
			)}
		</div>
	);
}
