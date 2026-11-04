"use client";

import { MessageFeedback } from "@repo/components/message-feedback.tsx";
import { MessageMemories } from "@repo/components/message-memories.tsx";
import type { EntryLine, ReportRow } from "@repo/evals/report";
import type { RunIdentity } from "@repo/evals/review";
import { reviewProperties, runId, traceEvents } from "@repo/evals/review";
import { entriesOf, memoryKind } from "@repo/interpreter/journal";
import type { ReactNode } from "react";
import { Turn } from "@/components/ui.tsx";
import { captureReview } from "@/lib/analytics.ts";
import type { ReviewTarget } from "@/lib/reviews.ts";

function EntryRow({ kind, children }: { kind: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-[54px_1fr] items-baseline gap-3 px-4 py-1">
			<span className="truncate text-[11px] text-yellow uppercase tracking-[0.14em]">
				{kind}
			</span>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

function Entry({ line }: { line: EntryLine }) {
	const [memory] = entriesOf([line], memoryKind);
	if (memory !== undefined)
		return (
			<EntryRow kind={line.kind}>
				<MessageMemories memories={[memory]} />
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
}: {
	identity: RunIdentity;
	row: ReportRow;
	target?: ReviewTarget;
}) {
	const run = runId(identity, row);

	return (
		<div className="pt-1 pb-2.5">
			{row.transcript.map((line, i) =>
				line.role === "entry" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: a transcript is static and repeated identical entries are the signal, not a bug
					<Entry key={i} line={line} />
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
