"use client";

import { useState } from "react";
import type { FiredMemory } from "./memories.ts";

const TRIGGER_COLORS: Record<string, string> = {
	error: "bg-red",
	call: "bg-blue",
	result: "bg-aqua",
	user: "bg-green",
	prose: "bg-purple",
	recall: "bg-yellow",
	start: "bg-orange",
	step: "bg-fg",
};

const MAX_STACKED = 5;

function triggerColor(on: string | undefined): string {
	return (on && TRIGGER_COLORS[on]) || "bg-dim";
}

function Dot({ on, stacked = false }: { on?: string; stacked?: boolean }) {
	return (
		<span
			aria-hidden
			data-memory-dot={on ?? ""}
			className={`inline-block size-[3px] shrink-0 rounded-full ${triggerColor(on)} ${
				stacked ? "-ml-px ring-1 ring-bg first:ml-0" : ""
			}`}
		/>
	);
}

export function MessageMemories({ memories }: { memories: FiredMemory[] }) {
	const [open, setOpen] = useState(false);

	if (memories.length === 0) return null;

	const count = memories.length;
	const label = `${count} memor${count === 1 ? "y" : "ies"} recalled`;
	const stacked = memories.slice(0, MAX_STACKED);
	const hidden = count - stacked.length;

	return (
		<div className="mt-1 select-none text-[11px] leading-[1.7]">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				title={label}
				className="inline-flex items-center gap-1.5 text-dim transition-colors hover:text-fg"
			>
				<span className="inline-flex items-center">
					{stacked.map((memory) => (
						<Dot key={memory.key} on={memory.on} stacked />
					))}
				</span>
				{hidden > 0 && <span>+{hidden}</span>}
				<span>{label}</span>
			</button>
			{open && (
				<div className="mt-1 flex flex-col gap-1 border-bg2 border-l pl-3 text-dim">
					{memories.map((memory) => (
						<div
							key={memory.key}
							className="flex min-w-0 items-baseline gap-1.5 break-words"
							title={memory.on ? `fires on ${memory.on}` : "recalled"}
						>
							<Dot on={memory.on} />
							<span>
								<span className="text-fg">{memory.key}</span>
								{memory.body ? ` — ${memory.body}` : null}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
