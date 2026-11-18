"use client";

import { ThumbsDownIcon, ThumbsUpIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@repo/ui";
import { cn } from "@repo/ui/lib/utils";
import { useRef, useState } from "react";
import { quip, surveyResponse, type Thumb } from "./feedback.ts";
import type { Marker } from "./file-tree.tsx";

export function MessageFeedback({
	capture,
	onRate,
	onThank,
	className,
	anchor,
}: {
	capture: (properties: Record<string, unknown>) => void;
	onRate?: (thumb: Thumb) => void;
	onThank?: (line: string) => void;
	className?: string;
	anchor?: Marker;
}) {
	const [thumb, setThumb] = useState<Thumb | null>(null);
	const submission = useRef<string | null>(null);
	const [asking, setAsking] = useState(false);
	const [draft, setDraft] = useState("");
	const rate = (value: Thumb) => {
		const submissionId = crypto.randomUUID();
		submission.current = submissionId;
		setThumb(value);
		setAsking(true);
		onRate?.(value);
		capture(surveyResponse({ thumb: value, submissionId }));
	};

	const explain = () => {
		const text = draft.trim();
		if (!text || !thumb || !submission.current) return;
		capture(surveyResponse({ thumb, submissionId: submission.current, text }));
		setDraft("");
		setAsking(false);
		onThank?.(quip(thumb));
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

			<Dialog onOpenChange={setAsking} open={asking}>
				<DialogContent className="sm:max-w-dialog-sm">
					<DialogHeader>
						<DialogTitle>
							{thumb === "up" ? "what worked?" : "what went wrong?"}
						</DialogTitle>
						<DialogDescription className="text-[11px]">
							optional, ⏎ to send, esc to skip
						</DialogDescription>
					</DialogHeader>
					<input
						className="min-w-0 bg-transparent text-[12px] text-yellow caret-yellow outline-none placeholder:text-dim"
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								explain();
							}
						}}
						placeholder={thumb === "up" ? "tell me more" : "tell me what broke"}
						value={draft}
					/>
				</DialogContent>
			</Dialog>
		</>
	);
}
