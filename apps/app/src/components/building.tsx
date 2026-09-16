import { Scramble } from "@repo/components";
import {
	Anvil,
	Cog,
	Drill,
	Hammer,
	type LucideIcon,
	PencilRuler,
	Pickaxe,
	Ruler,
	Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";

const TOOLS: LucideIcon[] = [
	Hammer,
	Wrench,
	Drill,
	Cog,
	PencilRuler,
	Pickaxe,
	Anvil,
	Ruler,
];

const BEAT_MS = 110;

function toolFor(seed: string): LucideIcon {
	let hash = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return TOOLS[(hash >>> 0) % TOOLS.length] as LucideIcon;
}

export function Building({ heads, busy }: { heads: string[]; busy: boolean }) {
	const [beat, setBeat] = useState(0);
	useEffect(() => {
		if (!busy) return;
		const id = setInterval(() => setBeat((b) => b + 1), BEAT_MS);
		return () => clearInterval(id);
	}, [busy]);

	if (heads.length === 0) return null;
	const Tool = busy
		? (TOOLS[beat % TOOLS.length] as LucideIcon)
		: toolFor(heads.join(" "));
	return (
		<div className="flex min-w-0 items-center gap-2 text-dim">
			<Tool
				aria-hidden
				size={busy ? 11 : 14}
				strokeWidth={1.5}
				className="flex-none"
			/>
			<span className="flex min-w-0 flex-wrap items-center gap-x-2">
				{heads.map((head) => (
					<Scramble key={head} text={head} />
				))}
			</span>
		</div>
	);
}
