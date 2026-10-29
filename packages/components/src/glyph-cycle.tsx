import {
	Atom02Icon,
	CodeIcon,
	FirstBracketIcon,
	FlowIcon,
	FunctionIcon,
	GitForkIcon,
	SigmaIcon,
	TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useState } from "react";

export const RUNNING_GLYPHS: readonly IconSvgElement[] = [
	FirstBracketIcon,
	FunctionIcon,
	SigmaIcon,
	TerminalIcon,
	CodeIcon,
	GitForkIcon,
	FlowIcon,
	Atom02Icon,
];

const GLYPH_BEAT_MS = 110;

export interface GlyphCycleProps {
	glyphs?: readonly IconSvgElement[];
	beatMs?: number;
	label?: string;
	className?: string;
}

export function GlyphCycle({
	glyphs = RUNNING_GLYPHS,
	beatMs = GLYPH_BEAT_MS,
	label = "Loading",
	className,
}: GlyphCycleProps) {
	const [beat, setBeat] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setBeat((b) => b + 1), beatMs);
		return () => clearInterval(timer);
	}, [beatMs]);
	const glyph = glyphs[beat % glyphs.length] ?? FirstBracketIcon;
	return (
		<HugeiconsIcon
			icon={glyph}
			role="status"
			aria-label={label}
			data-glyph={beat % glyphs.length}
			className={className}
		/>
	);
}
