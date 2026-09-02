import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";

/**
 * How the text is cut up on its way in: one character at a time, or one token —
 * which is what a model's stream actually looks like.
 */
export type Reveal = "char" | "token";

/** ms per step, per mode. A token is worth several characters, so it waits longer. */
const PACE: Record<Reveal, number> = { char: 16, token: 90 };

/**
 * The offsets a reveal stops at, in order, ending at the length of the text.
 *
 * For tokens the rule is the one a BPE vocabulary follows closely enough to be
 * convincing: a word carries the space in FRONT of it, so a line arrives as
 * "hello" then " there" and never as "hello " then "there"; and a long word
 * breaks into pieces of about four characters, because that is roughly where a
 * real vocabulary runs out of whole words.
 */
function stopsOf(text: string, reveal: Reveal): number[] {
	if (reveal === "char") {
		return Array.from({ length: text.length }, (_, i) => i + 1);
	}
	const stops: number[] = [];
	for (const match of text.matchAll(/\s*\S+/g)) {
		const start = match.index;
		const end = start + match[0].length;
		let at = start;
		while (end - at > 6) {
			at += 4;
			stops.push(at);
		}
		stops.push(end);
	}
	return stops;
}

/**
 * Reveal `text` progressively. When `enabled` is false the whole text is shown at
 * once — for an already-finished message, so history doesn't retype itself, and
 * for anyone who asked for less motion.
 *
 * The wait between steps is jittered by ±40%, which is the other half of looking
 * like a stream: a fixed interval reads as a machine typing, and a real one never
 * arrives on the beat.
 *
 * The reveal RESUMES rather than restarts: the timer is seeded from the count
 * already reached, held in a ref. That matters because an effect can be torn down
 * and set up again on the same instance — Strict Mode does it on every mount in
 * development, and so does a hot reload. This used to be guarded by an "already
 * started for this text" ref that returned early instead, which on the second
 * setup left the reveal frozen at zero characters, showing nothing at all.
 */
export function useTypewriter(
	text: string,
	{ speed, reveal = "char", enabled = true }: TypewriterOptions = {},
) {
	const stops = useMemo(() => stopsOf(text, reveal), [text, reveal]);
	const [shownFor, setShownFor] = useState(text);
	const [count, setCount] = useState(enabled ? 0 : stops.length);
	const reached = useRef(count);
	reached.current = count;

	// A different text starts over, adjusted during the render rather than in an
	// effect: an effect would show a slice of the old text for one frame first.
	if (shownFor !== text) {
		setShownFor(text);
		setCount(enabled ? 0 : stops.length);
	}

	useEffect(() => {
		if (!enabled) {
			setCount(stops.length);
			return;
		}
		const pace = Math.max(1, speed ?? PACE[reveal]);
		const wait = () => pace * (0.6 + Math.random() * 0.8);
		let i = reached.current;
		let timer = setTimeout(function step() {
			i += 1;
			setCount(i);
			if (i < stops.length) timer = setTimeout(step, wait());
		}, wait());
		return () => clearTimeout(timer);
	}, [stops, speed, reveal, enabled]);

	const upto = count <= 0 ? 0 : (stops[Math.min(count, stops.length) - 1] ?? 0);
	return { shown: text.slice(0, upto), done: count >= stops.length };
}

export interface TypewriterOptions {
	/** ms per step; defaults to the pace of the mode */
	speed?: number;
	reveal?: Reveal;
	enabled?: boolean;
}

export interface TypewriterProps extends TypewriterOptions {
	text: string;
	className?: string;
	onDone?: () => void;
}

/**
 * No cursor: the text arriving IS the animation, and a block riding the end of it
 * turned out to be one thing too many next to an avatar that is already alive.
 * `useTypewriter` returns `done`, so a consumer who wants one can draw its own.
 */
export function Typewriter({
	text,
	speed,
	reveal,
	enabled,
	className,
	onDone,
}: TypewriterProps) {
	const { shown, done } = useTypewriter(text, { speed, reveal, enabled });
	const firedDone = useRef(false);

	useEffect(() => {
		if (done && !firedDone.current) {
			firedDone.current = true;
			onDone?.();
		}
	}, [done, onDone]);

	return <span className={cn("whitespace-pre-wrap", className)}>{shown}</span>;
}
