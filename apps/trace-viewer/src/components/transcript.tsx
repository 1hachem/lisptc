"use client";

import { judgments, learnedNotes } from "@repo/components/learned.ts";
import { firedMemories } from "@repo/components/memories.ts";
import { MessageFeedback } from "@repo/components/message-feedback.tsx";
import { MessageLearned } from "@repo/components/message-learned.tsx";
import { MessageMemories } from "@repo/components/message-memories.tsx";
import type { RunIdentity } from "@repo/evals/review";
import { reviewProperties, runId, traceEvents } from "@repo/evals/review";
import { Turn } from "@/components/ui.tsx";
import { captureReview } from "@/lib/analytics.ts";
import type { ReportRow } from "@/lib/reports.ts";
import type { ReviewTarget } from "@/lib/reviews.ts";

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
			{row.transcript.map((line, i) => {
				const memories = firedMemories(line.annotations?.memories);
				const notes = learnedNotes(line.annotations?.learned);
				const judged = judgments(line.observed?.judged);
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: a transcript is static and repeated identical turns are the signal, not a bug
					<div className="group relative" key={i}>
						<Turn role={line.role}>{line.content.trimEnd()}</Turn>
						{memories.length > 0 ? (
							<div className="pr-4 pl-[66px]">
								<MessageMemories memories={memories} />
							</div>
						) : null}
						{notes.length > 0 || judged.length > 0 ? (
							<div className="pr-4 pl-[66px]">
								<MessageLearned notes={notes} judged={judged} />
							</div>
						) : null}
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
				);
			})}
		</div>
	);
}
