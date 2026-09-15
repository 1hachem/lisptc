import { useEffect, useState } from "react";

const TOOLS = ["🔨", "🔧", "🪛", "⚙️", "📐", "🧰", "⚡", "🪚"];

const BEAT_MS = 110;

export function Building({ heads, busy }: { heads: string[]; busy: boolean }) {
	const [beat, setBeat] = useState(0);
	useEffect(() => {
		if (!busy) return;
		const id = setInterval(() => setBeat((b) => b + 1), BEAT_MS);
		return () => clearInterval(id);
	}, [busy]);

	if (heads.length === 0) return null;
	const at = beat % heads.length;
	return (
		<div className="flex min-w-0 items-baseline gap-2 text-dim">
			<span aria-hidden className="select-none">
				{busy ? TOOLS[beat % TOOLS.length] : TOOLS[0]}
			</span>
			<span className="flex min-w-0 flex-wrap gap-x-2">
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
