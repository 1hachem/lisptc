import type { ExpressionId, StateId } from "@repo/bloub";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useChatSession } from "./chat.tsx";

/**
 * Everything the agent IS, in one place: what it is doing, what it feels, and
 * what it is saying.
 *
 * It is one character with three faces on screen — the avatar at the foot of the
 * transcript, the tab icon, and whatever the line lands next to — and they have
 * to agree. So the three live here rather than in whichever component happened to
 * need them first, which is where they were: the mood table in a `mood.ts` of its
 * own, the expression on the chat session, and the muttering inside the avatar
 * where nothing else could reach it.
 *
 * The split is between what the agent DOES and what it FEELS. Doing is derived
 * and read-only — `mood`, `state`, `label` are a function of the run, so nothing
 * can lie about whether the agent is working. Feeling and speaking are set, by
 * anyone, through `say`.
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

type MoodId = keyof typeof MOODS;

/**
 * The face the agent wears when nothing is happening, and the one a conversation
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
 * The faces the agent puts on by itself, one per finished run. It always comes
 * back to `REST_FACE`, and it always starts there.
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
 * How long a face is worn before it relaxes. Chosen: long enough to be read while
 * the reply is, short enough that the agent isn't still smirking at you an hour
 * later. A reaction ends.
 */
const FACE_MS = 8000;

/**
 * How long a line stays up after it has finished arriving — timed from `settle`,
 * not from `say`, because a line's own length decides when it is read.
 *
 * A second clock, and deliberately so: these two measure different things. The
 * face is a mood, worn while you read the reply; the line is read once and then
 * it is litter. They live in the same module, which is what was missing.
 */
const LINE_MS = 4000;

/** Say something, feel something, or both. Both are optional; neither is a turn. */
export interface Utterance {
	line?: string;
	/** one of `@repo/bloub`'s sixteen, with no set of moods in between to keep in step */
	face?: ExpressionId;
}

/**
 * A line on screen. `at` is the utterance it belongs to and not the line itself:
 * saying the same thing twice is allowed, and a reveal keyed on the text alone
 * would sit there already finished the second time.
 */
export interface Muttering {
	line: string;
	at: number;
}

interface Agent extends Mood {
	/** what the run is doing, and the only part of this nobody can set */
	mood: MoodId;
	/** what the face is wearing right now: a reaction, a rotation, or rest */
	face: ExpressionId;
	/** what it is saying, if anything */
	muttering: Muttering | null;
	say: (utterance: Utterance) => void;
	/** the line has arrived in full — start its `LINE_MS` */
	settle: () => void;
}

const AgentContext = createContext<Agent | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
	const { messages, isLoading, error, fresh } = useChatSession();

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

	const [face, setFace] = useState<ExpressionId>(REST_FACE);
	const [muttering, setMuttering] = useState<Muttering | null>(null);
	const faceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const next = useRef(0);
	const was = useRef(false);

	useEffect(
		() => () => {
			if (faceTimer.current) clearTimeout(faceTimer.current);
			if (lineTimer.current) clearTimeout(lineTimer.current);
		},
		[],
	);

	/**
	 * A finished run and a vote and a poke all put a face on for a while, and they
	 * arrive on top of each other — a vote usually lands while the run's own face
	 * is still being worn. One timer between them, so whichever came last owns when
	 * the face comes off.
	 */
	const wear = useCallback((expression: ExpressionId) => {
		setFace(expression);
		if (faceTimer.current) clearTimeout(faceTimer.current);
		faceTimer.current = setTimeout(() => setFace(REST_FACE), FACE_MS);
	}, []);

	const say = useCallback(
		({ line, face: expression }: Utterance) => {
			if (line !== undefined) {
				if (lineTimer.current) clearTimeout(lineTimer.current);
				setMuttering({ line, at: Date.now() });
			}
			if (expression) wear(expression);
		},
		[wear],
	);

	const settle = useCallback(() => {
		if (lineTimer.current) clearTimeout(lineTimer.current);
		lineTimer.current = setTimeout(() => setMuttering(null), LINE_MS);
	}, []);

	// The end of a run is what marks itself now that there is no wink.
	useEffect(() => {
		const finished = was.current && !isLoading;
		was.current = isLoading;
		if (!finished) return;
		wear(FACES[next.current % FACES.length]);
		next.current += 1;
	}, [isLoading, wear]);

	// `clear()` empties the transcript without remounting anything, so the reset
	// has to be watched for rather than left to the initial state.
	useEffect(() => {
		if (!fresh) return;
		setFace(REST_FACE);
		setMuttering(null);
	}, [fresh]);

	const value: Agent = {
		mood,
		...MOODS[mood],
		face,
		muttering,
		say,
		settle,
	};

	return (
		<AgentContext.Provider value={value}>{children}</AgentContext.Provider>
	);
}

export function useAgent(): Agent {
	const ctx = useContext(AgentContext);
	if (!ctx) throw new Error("useAgent must be used within an AgentProvider");
	return ctx;
}
