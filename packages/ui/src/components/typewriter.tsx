import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";

/**
 * Reveal `text` one character at a time. `speed` is ms per character (the
 * settings "typing speed" maps straight onto this). When `enabled` is false the
 * full text is shown at once — for an already-finished message, so history
 * doesn't retype itself, and for anyone who asked for less motion.
 *
 * The reveal RESUMES rather than restarts: the interval is seeded from the count
 * already reached, held in a ref. That matters because an effect can be torn down
 * and set up again on the same instance — Strict Mode does it on every mount in
 * development, and so does a hot reload. This used to be guarded by an "already
 * started for this text" ref that returned early instead, which on the second
 * setup left the reveal frozen at zero characters with the cursor blinking over
 * nothing at all.
 */
export function useTypewriter(text: string, speed = 16, enabled = true) {
	const [shownFor, setShownFor] = useState(text);
	const [count, setCount] = useState(enabled ? 0 : text.length);
	const reached = useRef(count);
	reached.current = count;

	// A different text starts over, adjusted during the render rather than in an
	// effect: an effect would show a slice of the old text for one frame first.
	if (shownFor !== text) {
		setShownFor(text);
		setCount(enabled ? 0 : text.length);
	}

	useEffect(() => {
		if (!enabled) {
			setCount(text.length);
			return;
		}
		let i = reached.current;
		const id = setInterval(
			() => {
				i += 1;
				setCount(i);
				if (i >= text.length) clearInterval(id);
			},
			Math.max(1, speed),
		);
		return () => clearInterval(id);
	}, [text, speed, enabled]);

	return { shown: text.slice(0, count), done: count >= text.length };
}

export interface TypewriterProps {
	text: string;
	speed?: number;
	enabled?: boolean;
	className?: string;
	cursorClassName?: string;
	onDone?: () => void;
}

export function Typewriter({
	text,
	speed,
	enabled = true,
	className,
	cursorClassName,
	onDone,
}: TypewriterProps) {
	const { shown, done } = useTypewriter(text, speed, enabled);
	const firedDone = useRef(false);

	useEffect(() => {
		if (done && !firedDone.current) {
			firedDone.current = true;
			onDone?.();
		}
	}, [done, onDone]);

	return (
		<span className={cn("whitespace-pre-wrap", className)}>
			{shown}
			{/*
			 * The block leads the text the whole way and stays once it has arrived:
			 * solid while characters are still coming, blinking when there are none
			 * left, like a prompt going back to rest. It is absent entirely when the
			 * reveal is off, so asking for less motion doesn't buy a blinking square.
			 */}
			{enabled && (
				<span
					className={cn(
						"ml-px inline-block h-[1.02em] w-[0.56em] translate-y-[0.16em] bg-aqua align-[-0.16em]",
						done && "animate-blk",
						cursorClassName,
					)}
				/>
			)}
		</span>
	);
}
