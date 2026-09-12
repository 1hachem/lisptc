"use client";

import { quip, surveyResponse, type Thumb } from "@repo/shared/feedback";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";

export function MessageFeedback({
	capture,
	onRate,
	className,
	reveal = "hover",
}: {
	capture: (properties: Record<string, unknown>) => void;
	onRate?: (thumb: Thumb) => void;
	className?: string;
	reveal?: "hover" | "always";
}) {
	const [thumb, setThumb] = useState<Thumb | null>(null);
	const submission = useRef<string | null>(null);
	const [asking, setAsking] = useState(false);
	const [draft, setDraft] = useState("");
	const [thanked, setThanked] = useState<string | null>(null);
	const field = useRef<HTMLInputElement>(null);
	const resting =
		reveal === "always"
			? "text-dim"
			: "text-dim opacity-0 focus:opacity-100 group-hover:opacity-100";

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
				className={cn(
					"flex select-none gap-1.5 text-[11px] leading-[1.7]",
					className,
				)}
			>
				<button
					className={cn(
						"transition-opacity hover:text-fg",
						thumb === "up" ? "text-yellow opacity-100" : resting,
					)}
					onClick={() => rate("up")}
					title="helpful"
					type="button"
				>
					▲
				</button>
				<button
					className={cn(
						"transition-opacity hover:text-fg",
						thumb === "down" ? "text-yellow opacity-100" : resting,
					)}
					onClick={() => rate("down")}
					title="not helpful"
					type="button"
				>
					▼
				</button>
			</div>

			{asking && (
				<div className="mt-1 flex items-center gap-2 border-yellow/40 border-l pl-3">
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
