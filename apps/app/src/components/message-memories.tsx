import { useState } from "react";
import type { FiredMemory } from "../lib/chat.tsx";

export function MessageMemories({ memories }: { memories: FiredMemory[] }) {
	const [open, setOpen] = useState(false);

	if (memories.length === 0) return null;

	const count = memories.length;
	const label = `${count} memor${count === 1 ? "y" : "ies"} recalled`;

	return (
		<div className="mt-1 select-none text-[11px] leading-[1.7]">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				title={label}
				className="text-yellow transition-colors hover:brightness-125"
			>
				◆ {label}
			</button>
			{open && (
				<div className="mt-1 flex flex-col gap-1 border-yellow/40 border-l pl-3 text-dim">
					{memories.map((memory) => (
						<div key={memory.key} className="min-w-0 break-words">
							<span className="text-fg">{memory.key}</span>
							{memory.body ? ` — ${memory.body}` : null}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
