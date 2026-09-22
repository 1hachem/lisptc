"use client";

import { useState } from "react";
import type { Judgment, LearnedNote } from "./learned.ts";

function pct(value: number | undefined): string {
	return value === undefined ? "—" : value.toFixed(2);
}

function summary(judgment: Judgment): string {
	if (judgment.failed !== undefined)
		return `the judge did not answer: ${judgment.failed}`;
	const parts = [
		`worth ${pct(judgment.worthKeeping)}`,
		`${judgment.kind ?? "—"} ${pct(judgment.kindConfidence)}`,
	];
	if (judgment.lesson !== undefined)
		parts.push(`lesson ${pct(judgment.lesson)}`);
	if (judgment.covered !== undefined)
		parts.push(
			`covered by ${judgment.covered.key} ${pct(judgment.covered.confidence)}`,
		);
	if (judgment.stale !== undefined)
		parts.push(`stale ${judgment.stale.key} ${pct(judgment.stale.confidence)}`);
	if (judgment.calibrated === false) parts.push("uncalibrated");
	parts.push(
		judgment.did.length === 0 ? "did nothing" : judgment.did.join(", "),
	);
	return parts.join(" · ");
}

function label(notes: LearnedNote[], judged: Judgment[]): string {
	if (notes.length > 0) {
		const count = notes.length;
		return `${count} learning note${count === 1 ? "" : "s"}`;
	}
	if (judged.some((one) => one.failed !== undefined)) return "judge failed";
	return "judged, nothing kept";
}

export function MessageLearned({
	notes,
	judged = [],
}: {
	notes: LearnedNote[];
	judged?: Judgment[];
}) {
	const [open, setOpen] = useState(false);

	if (notes.length === 0 && judged.length === 0) return null;

	const failed = judged.some((one) => one.failed !== undefined);
	const head = label(notes, judged);

	return (
		<div className="mt-1 select-none text-[11px] leading-[1.7]">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				title={head}
				className={`transition-colors hover:brightness-125 ${failed ? "text-red" : "text-green"}`}
			>
				◆ {head}
			</button>
			{open && (
				<div
					className={`mt-1 flex flex-col gap-1 border-l pl-3 text-dim ${failed ? "border-red/40" : "border-green/40"}`}
				>
					{notes.map((note) => (
						<div
							key={`${note.what}:${note.text}`}
							className="min-w-0 break-words"
						>
							<span className="text-fg">{note.what}</span> — {note.text}
						</div>
					))}
					{judged.map((judgment) => (
						<div key={summary(judgment)} className="min-w-0 break-words">
							{summary(judgment)}
							{judgment.candidate ? (
								<div className="text-fg">{judgment.candidate}</div>
							) : null}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
