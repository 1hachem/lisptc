import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";

export type Reveal = "char" | "token";

const PACE: Record<Reveal, number> = { char: 16, token: 90 };

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

export function useTypewriter(
	text: string,
	{ speed, reveal = "char", enabled = true }: TypewriterOptions = {},
) {
	const stops = useMemo(() => stopsOf(text, reveal), [text, reveal]);
	const [shownFor, setShownFor] = useState(text);
	const [count, setCount] = useState(enabled ? 0 : stops.length);
	const reached = useRef(count);
	reached.current = count;

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
	speed?: number;
	reveal?: Reveal;
	enabled?: boolean;
}

export interface TypewriterProps extends TypewriterOptions {
	text: string;
	className?: string;
	onDone?: () => void;
}

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
