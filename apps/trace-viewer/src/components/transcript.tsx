"use client";

import { MessageFeedback } from "@repo/components/message-feedback.tsx";
import { MessageJudgements } from "@repo/components/message-judgements.tsx";
import { MessageMemories } from "@repo/components/message-memories.tsx";
import type { EntryLine, ReportRow, TranscriptLine } from "@repo/evals/report";
import type { RunIdentity } from "@repo/evals/review";
import { reviewProperties, runId, traceEvents } from "@repo/evals/review";
import {
	type FiredMemory,
	memoryKind,
	type Recognized,
	recognizedKind,
} from "@repo/journal-catalog/memory";
import { WHEN_FIRES_AT } from "@repo/memory-extension/ports";
import { view } from "@repo/shared/journal";
import type { ReactNode } from "react";
import { Turn } from "@/components/ui.tsx";
import { captureReview } from "@/lib/analytics.ts";
import { memoryReviewProperties } from "@/lib/memory-review.ts";
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

type Item =
	| { kind: "line"; at: number; line: TranscriptLine }
	| {
			kind: "memories";
			at: number;
			memories: FiredMemory[];
			recognition?: Recognized;
	  };

type Capture = (properties: Record<string, unknown>) => void;

function recognizedOf(line: TranscriptLine): Recognized | undefined {
	if (line.role !== "entry") return undefined;
	return view([{ ...line, id: line.kind }], recognizedKind)[0];
}

function memoryOf(line: TranscriptLine): FiredMemory | undefined {
	if (line.role !== "entry") return undefined;
	return view([{ ...line, id: line.kind }], memoryKind)[0];
}

function itemsOf(lines: readonly TranscriptLine[], reflex: boolean): Item[] {
	const items: Item[] = [];
	lines.forEach((line, at) => {
		const recognized = recognizedOf(line);
		if (recognized !== undefined) {
			if (reflex) items.push({ kind: "line", at, line });
			if (recognized.fired !== undefined)
				items.push({
					kind: "memories",
					at,
					memories: recognized.fired,
					recognition: recognized,
				});
			return;
		}
		const memory = memoryOf(line);
		if (memory === undefined) {
			items.push({ kind: "line", at, line });
			return;
		}
		const last = items.at(-1);
		if (last?.kind === "memories" && last.recognition === undefined)
			last.memories.push(memory);
		else items.push({ kind: "memories", at, memories: [memory] });
	});
	return items;
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

function Memories({
	memories,
	recognized,
	capture,
}: {
	memories: FiredMemory[];
	recognized: boolean;
	capture?: Capture;
}) {
	return (
		<div className="group relative">
			<EntryRow kind={memoryKind.name} selected={recognized}>
				<MessageMemories
					memories={memories}
					{...(recognized
						? { selected: new Set(memories.map((memory) => memory.key)) }
						: {})}
				/>
			</EntryRow>
			<Feedback capture={capture} />
		</div>
	);
}

function SystemPrompt({ text }: { text: string }) {
	return (
		<EntryRow kind="system">
			<details className="text-[11px] leading-[1.7]">
				<summary className="cursor-pointer select-none text-dim marker:text-dim">
					system prompt · {text.length.toLocaleString()} chars
				</summary>
				<pre className="m-0 mt-1 whitespace-pre-wrap break-words border-bg2 border-l pl-2.5 font-mono text-dim">
					{text}
				</pre>
			</details>
		</EntryRow>
	);
}

function Entry({
	line,
	review,
}: {
	line: EntryLine;
	review: (extra: Record<string, unknown>) => Capture | undefined;
}) {
	const [recognized] = view([{ ...line, id: line.kind }], recognizedKind);
	if (recognized !== undefined)
		return (
			<div className="group relative">
				<EntryRow kind={line.kind}>
					<details className="group/recognition text-[11px] leading-[1.7]">
						<summary className="cursor-pointer select-none text-dim marker:text-dim">
							{recognized.error === undefined ? (
								<span>
									recognition log · {Object.keys(recognized.scores).length}{" "}
									situations · {recognized.fired?.length ?? 0} fired
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
				</EntryRow>
				<Feedback
					capture={review(
						memoryReviewProperties({
							memories: recognized.fired ?? [],
							recognition: recognized,
						}),
					)}
				/>
			</div>
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
	const items = itemsOf(row.transcript, reflex);
	const review =
		(at: number) =>
		(extra: Record<string, unknown>): Capture | undefined =>
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

	return (
		<div className="pt-1 pb-2.5">
			{row.system === undefined ? null : <SystemPrompt text={row.system} />}
			{items.map((item) => {
				if (item.kind === "memories")
					return (
						<Memories
							key={`${item.at}:memories`}
							memories={item.memories}
							recognized={item.recognition !== undefined}
							capture={review(item.at)(
								memoryReviewProperties({
									memories: item.memories,
									...(item.recognition === undefined
										? {}
										: { recognition: item.recognition }),
								}),
							)}
						/>
					);
				const { at, line } = item;
				if (line.role === "entry")
					return <Entry key={at} line={line} review={review(at)} />;
				return (
					<div className="group relative" key={at}>
						<Turn role={line.role}>{line.content.trimEnd()}</Turn>
						{target && line.role === "assistant" ? (
							<div className="pr-4 pl-[66px]">
								<MessageFeedback
									capture={(properties) => review(at)({})?.(properties)}
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
