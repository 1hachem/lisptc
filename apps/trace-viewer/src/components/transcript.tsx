"use client";

import type { RunIdentity } from "@repo/evals/review";
import { reviewProperties } from "@repo/evals/review";
import { MessageFeedback } from "@repo/ui/components/message-feedback.tsx";
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
	return (
		<div className="pt-1 pb-2.5">
			{row.transcript.map((line, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a transcript is static and repeated identical turns are the signal, not a bug
				<div className="group relative" key={i}>
					<Turn role={line.role}>{line.content.trimEnd()}</Turn>
					{target && line.role === "assistant" ? (
						<div className="pr-4 pl-[66px]">
							<MessageFeedback
								capture={(properties) =>
									captureReview(target, {
										...properties,
										...reviewProperties(identity, row, i),
									})
								}
								className="absolute top-1.5 right-3"
								reveal="always"
							/>
						</div>
					) : null}
				</div>
			))}
		</div>
	);
}
