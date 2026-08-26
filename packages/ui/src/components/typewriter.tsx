import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";

/**
 * Reveal `text` one character at a time. `speed` is ms per character
 * (the settings "typing speed" maps straight onto this). When `enabled`
 * is false the full text is shown immediately (used for already-finished
 * messages so history doesn't retype itself on every render).
 */
export function useTypewriter(text: string, speed = 16, enabled = true) {
	const [count, setCount] = useState(enabled ? 0 : text.length);
	const startedFor = useRef<string | null>(null);

	useEffect(() => {
		if (!enabled) {
			setCount(text.length);
			return;
		}
		if (startedFor.current === text) return;
		startedFor.current = text;
		setCount(0);
		let i = 0;
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
			{!done && (
				<span
					className={cn(
						"ml-px inline-block h-[1.02em] w-[0.56em] translate-y-[0.16em] bg-aqua align-[-0.16em]",
						"animate-blk",
						cursorClassName,
					)}
				/>
			)}
		</span>
	);
}
