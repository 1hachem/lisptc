import { PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { lineDiff } from "../lib/line-diff.ts";
import type { Written } from "../lib/written.ts";
import { LispText } from "./lisp-text.tsx";

const MARK = { same: " ", removed: "-", added: "+" } as const;

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
		<div className="mb-1 min-w-0 text-dim" data-written-as>
			<div className="flex min-w-0 items-start gap-2">
				<HugeiconsIcon
					icon={PencilEdit01Icon}
					size={14}
					className="mt-1 flex-none"
				/>
				<div className="min-w-0 whitespace-pre-wrap break-words">
					<LispText>{written.text}</LispText>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-3 pl-6 text-[12px]">
				{written.because && <span>{written.because}</span>}
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
				<pre className="mt-1 overflow-x-auto pl-6 font-mono text-[12px]">
					{changes.map((line) => (
						<div key={line.at} className={TONE[line.kind]}>
							{MARK[line.kind]} {line.text}
						</div>
					))}
				</pre>
			)}
		</div>
	);
}
