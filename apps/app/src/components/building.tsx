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
import { Scramble } from "@repo/components";
import { useEffect, useState } from "react";

const GLYPHS: IconSvgElement[] = [
	FirstBracketIcon,
	FunctionIcon,
	SigmaIcon,
	TerminalIcon,
	CodeIcon,
	GitForkIcon,
	FlowIcon,
	Atom02Icon,
];

const BEAT_MS = 110;

function glyphFor(seed: string): IconSvgElement {
	let hash = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return GLYPHS[(hash >>> 0) % GLYPHS.length] as IconSvgElement;
}

export function Building({
	id,
	heads,
	busy,
}: {
	id: string;
	heads: string[];
	busy: boolean;
}) {
	const [beat, setBeat] = useState(0);
	useEffect(() => {
		if (!busy) return;
		const id = setInterval(() => setBeat((b) => b + 1), BEAT_MS);
		return () => clearInterval(id);
	}, [busy]);

	if (heads.length === 0) return null;
	const glyph = busy
		? (GLYPHS[beat % GLYPHS.length] as IconSvgElement)
		: glyphFor(heads.join(" "));
	return (
		<div className="flex min-w-0 items-center gap-2 text-dim">
			<HugeiconsIcon
				icon={glyph}
				aria-hidden
				size={busy ? 11 : 14}
				strokeWidth={1.5}
				className="flex-none"
			/>
			<span className="flex min-w-0 flex-wrap items-center gap-x-2">
				{heads.map((head) => (
					<Scramble
						key={head}
						text={head}
						enabled={busy}
						once={`${id} ${head}`}
					/>
				))}
			</span>
		</div>
	);
}
