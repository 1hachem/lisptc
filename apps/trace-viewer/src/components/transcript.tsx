"use client";

import {
	type ChatMessage,
	entriesOfMessage,
	isToolMessage,
	messageText,
	Trace,
	type TraceSlots,
} from "@repo/components";
import { MessageFeedback } from "@repo/components/message-feedback.tsx";
import { MessageJudgements } from "@repo/components/message-judgements.tsx";
import type { ReportRow, TranscriptLine } from "@repo/evals/report";
import type { RunIdentity } from "@repo/evals/review";
import { reviewProperties, runId, traceEvents } from "@repo/evals/review";
import { type Recognized, recognizedKind } from "@repo/journal-catalog/memory";
import { systemPromptKind } from "@repo/journal-catalog/system";
import { WHEN_FIRES_AT } from "@repo/memory-extension/ports";
import { view } from "@repo/shared/journal";
import { useMemo } from "react";
import { Turn } from "@/components/ui.tsx";
import { captureReview } from "@/lib/analytics.ts";
import { memoryReviewProperties } from "@/lib/memory-review.ts";
import type { ReviewTarget } from "@/lib/reviews.ts";

type Capture = (properties: Record<string, unknown>) => void;

const LINE_TYPE = { user: "human", assistant: "ai", tool: "tool" } as const;

const SYSTEM_ID = "system";

function messageOf(line: TranscriptLine, at: number): ChatMessage {
	const id = String(at);
	if (line.role === "entry")
		return {
			id,
			type: "entry",
			content: "",
			additional_kwargs: { kind: line.kind, value: line.value },
		};
	if (line.role === "system")
		return {
			id,
			type: "system",
			content: line.content,
			additional_kwargs: { source: line.source ?? "system", noted: true },
		};
	return { id, type: LINE_TYPE[line.role], content: line.content };
}

function messagesOf(row: ReportRow): ChatMessage[] {
	const messages = row.transcript.map(messageOf);
	const prompted = row.transcript.some(
		(line) => line.role === "entry" && line.kind === systemPromptKind.name,
	);
	if (prompted || row.system === undefined) return messages;
	return [
		{
			id: SYSTEM_ID,
			type: "entry",
			content: "",
			additional_kwargs: {
				kind: systemPromptKind.name,
				value: { text: row.system },
			},
		},
		...messages,
	];
}

function indexOf(message: ChatMessage): number | undefined {
	const at = Number(message.id);
	return Number.isInteger(at) ? at : undefined;
}

function recognizedOf(message: ChatMessage): Recognized | undefined {
	return view(entriesOfMessage(message), recognizedKind).at(-1);
}

function Feedback({ capture }: { capture?: Capture }) {
	if (capture === undefined) return null;
	return (
		<MessageFeedback
			capture={capture}
			className="absolute top-1 right-3"
			reveal="always"
		/>
	);
}

function RecognitionLog({ recognized }: { recognized: Recognized }) {
	return (
		<details className="text-[11px] leading-[1.7]">
			<summary className="cursor-pointer select-none text-dim marker:text-dim">
				{recognized.error === undefined ? (
					<span>
						recognition log · {Object.keys(recognized.scores).length} situations
						· {recognized.fired?.length ?? 0} fired
					</span>
				) : (
					<span className="text-red">
						recognition failed: {recognized.error}
					</span>
				)}
			</summary>
			<div className="mt-1 flex flex-col gap-1 border-bg2 border-l pl-2.5">
				<div className="text-dim">on “{recognized.message}”</div>
				{recognized.step === undefined ? null : (
					<pre className="m-0 whitespace-pre-wrap break-words font-mono text-dim">
						{recognized.step}
					</pre>
				)}
				<MessageJudgements
					scores={recognized.scores}
					firesAt={WHEN_FIRES_AT}
					{...(recognized.error === undefined
						? {}
						: { error: recognized.error })}
				/>
			</div>
		</details>
	);
}

function CarriedEntries({ message }: { message: ChatMessage }) {
	const entries = message.entries ?? [];
	if (entries.length === 0) return null;
	return (
		<div className="flex flex-col gap-1 pr-4 pl-[82px]">
			{entries.map((entry) => (
				<pre
					key={entry.id}
					className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] text-dim"
				>
					<span className="text-yellow">{entry.kind}</span>{" "}
					{JSON.stringify(entry.value)}
				</pre>
			))}
		</div>
	);
}

function evalSlots(
	review: (at: number, extra: Record<string, unknown>) => Capture | undefined,
	reflex: boolean,
): TraceSlots {
	return {
		line: (message) => (
			<>
				<Turn role={isToolMessage(message) ? "tool" : "assistant"}>
					{messageText(message).trimEnd()}
				</Turn>
				{isToolMessage(message) && <CarriedEntries message={message} />}
			</>
		),
		aside: (message) => {
			const at = indexOf(message);
			if (at === undefined || isToolMessage(message)) return null;
			return <Feedback capture={review(at, {})} />;
		},
		entry: (message) => {
			const recognition = recognizedOf(message);
			if (!reflex || recognition === undefined) return null;
			const at = indexOf(message);
			return (
				<div className="group relative flex flex-col gap-1">
					<RecognitionLog recognized={recognition} />
					{at !== undefined && (
						<Feedback
							capture={review(
								at,
								memoryReviewProperties({
									memories: recognition.fired ?? [],
									recognition,
								}),
							)}
						/>
					)}
				</div>
			);
		},
	};
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
	const messages = useMemo(() => messagesOf(row), [row]);
	const slots = useMemo(() => {
		const run = runId(identity, row);
		const review = (
			at: number,
			extra: Record<string, unknown>,
		): Capture | undefined =>
			target === undefined
				? undefined
				: (properties) =>
						captureReview(target, {
							runId: run,
							trace: traceEvents(identity, row),
							properties: {
								...properties,
								...reviewProperties(identity, row, at),
								...extra,
							},
						});
		return evalSlots(review, reflex);
	}, [identity, row, target, reflex]);
	return <Trace messages={messages} slots={slots} />;
}
