import {
	type Aim,
	BloubBot,
	type GazeScript,
	type Look,
	PITCH_MAX,
	YAW_MAX,
} from "@repo/bloub";
import { Typewriter } from "@repo/ui";
import { useCallback, useEffect, useRef } from "react";
import { type Utterance, useAgent } from "../lib/agent.tsx";
import { usePrefersReducedMotion } from "../lib/motion.ts";
import {
	pickBusyPoke,
	pickDoublePoke,
	pickEnoughPoke,
	pickHoverPoke,
	pickPoke,
} from "../lib/poke.ts";

function ahead({ nx, ny, pointer }: Aim): Look {
	return {
		yaw: nx * YAW_MAX,
		pitch: -ny * PITCH_MAX,
		mix: 1,
		spin: 0,
		wander: pointer ? 0 : 1,
	};
}

const UPWARD: GazeScript = () => ({
	yaw: YAW_MAX,
	pitch: 26,
	mix: 1,
	spin: 0,
	wander: 1,
});

const DOUBLE_MS = 400;

const BURST_MS = 1500;

const BURST_LIMIT = 6;

const HOVER_MS = 2500;

function usePokeGestures(
	say: (utterance: Utterance) => void,
	said: string | undefined,
	working: boolean,
) {
	const lastAt = useRef(0);
	const burst = useRef(0);
	const linger = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (linger.current) clearTimeout(linger.current);
		},
		[],
	);

	const poke = useCallback(() => {
		const at = Date.now();
		const gap = at - lastAt.current;
		const doubled = gap < DOUBLE_MS;
		burst.current = gap < BURST_MS ? burst.current + 1 : 1;
		lastAt.current = at;

		if (burst.current > BURST_LIMIT) return;

		const pick =
			burst.current === BURST_LIMIT
				? pickEnoughPoke
				: doubled
					? pickDoublePoke
					: working
						? pickBusyPoke
						: pickPoke;
		say(pick(Math.random(), said));
	}, [say, working, said]);

	return {
		poke,
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
					say(pickHoverPoke(Math.random(), said));
				}, HOVER_MS);
			},
			[say, said],
		),
		unhover: useCallback(() => {
			if (linger.current) clearTimeout(linger.current);
			linger.current = null;
		}, []),
	};
}

export function AgentAvatar({ size = 28 }: { size?: number }) {
	const { mood, state, label, face, muttering, say, settle } = useAgent();
	const reduced = usePrefersReducedMotion();
	const { poke, hover, unhover } = usePokeGestures(
		say,
		muttering?.line,
		mood === "thinking" || mood === "busy",
	);

	return (
		<div className="flex select-none items-center gap-2">
			<span className="sr-only" aria-live="polite">
				{label}
			</span>
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
						eyeScale={1.29}
						state={state}
						follow={mood === "idle"}
						aim={ahead}
						gaze={mood === "busy" ? UPWARD : null}
						ink="var(--fg)"
						paper="var(--bg)"
						ariaLabel={label}
					/>
				</span>
			</button>
			{muttering && (
				<>
					<span className="sr-only" aria-live="polite">
						{muttering.line}
					</span>
					<span aria-hidden="true" className="min-w-0 break-words text-dim">
						<Typewriter
							key={muttering.at}
							text={muttering.line}
							reveal="token"
							enabled={!reduced}
							onDone={settle}
						/>
					</span>
				</>
			)}
		</div>
	);
}
