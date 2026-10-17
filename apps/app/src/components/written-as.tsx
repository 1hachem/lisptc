import { useMemo, useState } from "react";
import { lineDiff } from "../lib/line-diff.ts";
import type { Written } from "../lib/written.ts";
import { LispText } from "./lisp-text.tsx";

const MARK = { same: "", removed: "-", added: "+" } as const;

const TONE = {
	same: "text-dim",
	removed: "text-red",
	added: "text-green",
} as const;

export function WrittenAs({ written, ran }: { written: Written; ran: string }) {
	const [open, setOpen] = useState(false);
	const changes = useMemo(
		() =>
			written.from === undefined
				? []
				: lineDiff(written.from, ran).map((line, at) => ({ ...line, at })),
		[written.from, ran],
	);
	return (
		<div
			className="min-w-0 border-yellow/40 border-l pl-3 text-dim"
			data-written-as
		>
			<div className="whitespace-pre-wrap break-words">
				<LispText>{written.text}</LispText>
			</div>
			<div className="flex flex-wrap items-center gap-3 text-[12px]">
				{changes.length > 0 && (
					<button
						type="button"
						onClick={() => setOpen(!open)}
						className="underline decoration-dim/40 hover:text-fg"
					>
						{open ? "hide changes" : "show changes"}
					</button>
				)}
			</div>
			{open && (
				<div className="mt-1 overflow-x-auto font-mono text-[12px]">
					{changes.map((line) => (
						<div
							key={line.at}
							className={`flex ${TONE[line.kind]}`}
							data-change={line.kind}
						>
							<span aria-hidden className="w-4 flex-none select-none">
								{MARK[line.kind]}
							</span>
							<span className="whitespace-pre">{line.text}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
