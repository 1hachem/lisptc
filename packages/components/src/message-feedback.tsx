"use client";

import { ThumbsDownIcon, ThumbsUpIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@repo/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { quip, surveyResponse, type Thumb } from "./feedback.ts";
import type { Marker } from "./file-tree.tsx";

export function MessageFeedback({
	capture,
	onRate,
	className,
	anchor,
}: {
	capture: (properties: Record<string, unknown>) => void;
	onRate?: (thumb: Thumb) => void;
	className?: string;
	anchor?: Marker;
}) {
	const [thumb, setThumb] = useState<Thumb | null>(null);
	const submission = useRef<string | null>(null);
	const [asking, setAsking] = useState(false);
	const [draft, setDraft] = useState("");
	const [thanked, setThanked] = useState<string | null>(null);
	const field = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (asking) field.current?.focus();
	}, [asking]);

	const rate = (value: Thumb) => {
		const submissionId = crypto.randomUUID();
		submission.current = submissionId;
		setThumb(value);
		setAsking(true);
		setThanked(null);
		onRate?.(value);
		capture(surveyResponse({ thumb: value, submissionId }));
	};

	const explain = () => {
		const text = draft.trim();
		if (!text || !thumb || !submission.current) return;
		capture(surveyResponse({ thumb, submissionId: submission.current, text }));
		setDraft("");
		setAsking(false);
		setThanked(quip(thumb));
	};

	return (
		<>
			<div
				{...anchor}
				className={cn(
					"flex select-none gap-1.5 text-[11px] leading-[1.7]",
					className,
				)}
			>
				<button
					className={cn(
						"hover:text-fg",
						thumb === "up" ? "text-yellow" : "text-dim",
					)}
					onClick={() => rate("up")}
					title="helpful"
					type="button"
				>
					<HugeiconsIcon
						icon={ThumbsUpIcon}
						aria-hidden
						className="size-icon"
					/>
				</button>
				<button
					className={cn(
						"hover:text-fg",
						thumb === "down" ? "text-yellow" : "text-dim",
					)}
					onClick={() => rate("down")}
					title="not helpful"
					type="button"
				>
					<HugeiconsIcon
						icon={ThumbsDownIcon}
						aria-hidden
						className="size-icon"
					/>
				</button>
			</div>

			{asking && (
				<div
					{...anchor}
					className="mt-1 flex items-center gap-2 border-yellow/40 border-l pl-3"
				>
					<span className="select-none text-[11px] text-dim">
						{thumb === "up" ? "what worked?" : "what went wrong?"}
					</span>
					<input
						className="min-w-0 flex-1 bg-transparent text-[12px] text-yellow caret-yellow outline-none placeholder:text-dim"
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								explain();
							}
							if (e.key === "Escape") setAsking(false);
						}}
						placeholder="optional — ⏎ to send, esc to skip"
						ref={field}
						value={draft}
					/>
				</div>
			)}

			{thanked && (
				<div className="mt-1 select-none text-[11px] text-dim">{thanked}</div>
			)}
		</>
	);
}
