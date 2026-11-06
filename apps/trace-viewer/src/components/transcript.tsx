"use client";

import { MessageFeedback } from "@repo/components/message-feedback.tsx";
import { MessageJudgements } from "@repo/components/message-judgements.tsx";
import { MessageMemories } from "@repo/components/message-memories.tsx";
import type { EntryLine, ReportRow, TranscriptLine } from "@repo/evals/report";
import type { RunIdentity } from "@repo/evals/review";
import { reviewProperties, runId, traceEvents } from "@repo/evals/review";
import { judgedKind, memoryKind } from "@repo/journal-catalog/memory";
import { WHEN_FIRES_AT } from "@repo/memory-extension/ports";
import { view } from "@repo/shared/journal";
import type { ReactNode } from "react";
import { Turn } from "@/components/ui.tsx";
import { captureReview } from "@/lib/analytics.ts";
import type { ReviewTarget } from "@/lib/reviews.ts";

function EntryRow({
	kind,
	selected = false,
	children,
}: {
	kind: string;
	selected?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			data-selected={selected || undefined}
			className={
				selected
					? "grid grid-cols-[54px_1fr] items-baseline gap-3 border-green border-l-2 bg-green/10 py-1 pr-4 pl-[14px]"
					: "grid grid-cols-[54px_1fr] items-baseline gap-3 px-4 py-1"
			}
		>
			<span className="truncate text-[11px] text-yellow uppercase tracking-[0.14em]">
				{kind}
			</span>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

function selectedMemories(
	lines: readonly TranscriptLine[],
): ReadonlySet<number> {
	const selected = new Set<number>();
	let waiting = new Set<string>();
	lines.forEach((line, at) => {
		if (line.role !== "entry") return;
		const [judged] = view([{ ...line, id: line.kind }], judgedKind);
		if (judged !== undefined) {
			waiting = new Set(judged.selected ?? []);
			return;
		}
		const [memory] = view([{ ...line, id: line.kind }], memoryKind);
		if (memory !== undefined && waiting.delete(memory.key)) selected.add(at);
	});
	return selected;
}

function Entry({ line, selected }: { line: EntryLine; selected: boolean }) {
	const [memory] = view([{ ...line, id: line.kind }], memoryKind);
	if (memory !== undefined)
		return (
			<EntryRow kind={line.kind} selected={selected}>
				<MessageMemories memories={[memory]} />
			</EntryRow>
		);
	const [judged] = view([{ ...line, id: line.kind }], judgedKind);
	if (judged !== undefined)
		return (
			<EntryRow kind={line.kind}>
				<details className="group/judge text-[11px] leading-[1.7]">
					<summary className="cursor-pointer select-none text-dim marker:text-dim">
						{judged.error === undefined ? (
							<span>
								judge log · {Object.keys(judged.scores).length} situations ·{" "}
								{judged.selected?.length ?? 0} selected
							</span>
						) : (
							<span className="text-red">judge failed: {judged.error}</span>
						)}
					</summary>
					<div className="mt-1 flex flex-col gap-1 border-bg2 border-l pl-2.5">
						<div className="text-dim">on “{judged.message}”</div>
						{judged.step === undefined ? null : (
							<pre className="m-0 whitespace-pre-wrap break-words font-mono text-dim">
								{judged.step}
							</pre>
						)}
						<MessageJudgements
							scores={judged.scores}
							firesAt={WHEN_FIRES_AT}
							{...(judged.error === undefined ? {} : { error: judged.error })}
						/>
					</div>
				</details>
			</EntryRow>
		);
	return (
		<EntryRow kind={line.kind}>
			<pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] text-dim">
				{JSON.stringify(line.value)}
			</pre>
		</EntryRow>
	);
}

export function Transcript({
	identity,
	row,
	target,
	reflex,
}: {
	identity: RunIdentity;
	row: ReportRow;
	target?: ReviewTarget;
	reflex: boolean;
}) {
	const run = runId(identity, row);
	const selected = selectedMemories(row.transcript);

	return (
		<div className="pt-1 pb-2.5">
			{row.transcript.map((line, i) =>
				line.role === "entry" ? (
					!reflex && line.kind === judgedKind.name ? null : (
						// biome-ignore lint/suspicious/noArrayIndexKey: a transcript is static and repeated identical entries are the signal, not a bug
						<Entry key={i} line={line} selected={selected.has(i)} />
					)
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: a transcript is static and repeated identical turns are the signal, not a bug
					<div className="group relative" key={i}>
						<Turn role={line.role}>{line.content.trimEnd()}</Turn>
						{target && line.role === "assistant" ? (
							<div className="pr-4 pl-[66px]">
								<MessageFeedback
									capture={(properties) =>
										captureReview(target, {
											runId: run,
											trace: traceEvents(identity, row),
											properties: {
												...properties,
												...reviewProperties(identity, row, i),
											},
										})
									}
									className="absolute top-1.5 right-3"
									reveal="always"
								/>
							</div>
						) : null}
					</div>
				),
			)}
		</div>
	);
}
