import { cn } from "@repo/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789/-<>?!$#%&*+";

const BEAT_MS = 45;

const BEATS_PER_CHAR = 2;

function maskedAt(text: string, beat: number): string {
	const settled = Math.floor(beat / BEATS_PER_CHAR);
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] as string;
		if (i < settled || ch === " ") out += ch;
		else out += GLYPHS[(beat * 7 + i * 13) % GLYPHS.length];
	}
	return out;
}

const played = new Set<string>();

export interface ScrambleProps {
	text: string;
	className?: string;
	enabled?: boolean;
	once?: string;
}

export function Scramble({
	text,
	className,
	enabled = true,
	once,
}: ScrambleProps) {
	const beats = text.length * BEATS_PER_CHAR;
	const plays = enabled && (once === undefined || !played.has(once));
	const [shownFor, setShownFor] = useState(text);
	const [beat, setBeat] = useState(plays ? 0 : beats);
	const reached = useRef(beat);
	reached.current = beat;

	if (shownFor !== text) {
		setShownFor(text);
		setBeat(plays ? 0 : beats);
	}

	useEffect(() => {
		if (!plays) {
			setBeat(beats);
			return;
		}
		if (reached.current >= beats) return;
		let b = reached.current;
		const id = setInterval(() => {
			b += 1;
			setBeat(b);
			if (b < beats) return;
			clearInterval(id);
			if (once !== undefined) played.add(once);
		}, BEAT_MS);
		return () => clearInterval(id);
	}, [plays, beats, once]);

	return (
		<span className={cn("whitespace-pre", className)}>
			{maskedAt(text, beat)}
		</span>
	);
}
