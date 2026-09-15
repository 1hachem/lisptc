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

export function Building({ heads, busy }: { heads: string[]; busy: boolean }) {
	const [beat, setBeat] = useState(0);
	useEffect(() => {
		if (!busy) return;
		const id = setInterval(() => setBeat((b) => b + 1), BEAT_MS);
		return () => clearInterval(id);
	}, [busy]);

	if (heads.length === 0) return null;
	const Tool = busy ? TOOLS[beat % TOOLS.length] : TOOLS[0];
	const at = beat % heads.length;
	return (
		<div className="flex min-w-0 items-center gap-2 text-dim">
			<Tool aria-hidden size={14} strokeWidth={1.5} className="flex-none" />
			<span className="flex min-w-0 flex-wrap items-center gap-x-2">
				{heads.map((head, i) => (
					<span
						key={head}
						className={busy && i === at ? "text-accent" : undefined}
					>
						{head}
					</span>
				))}
			</span>
		</div>
	);
}
