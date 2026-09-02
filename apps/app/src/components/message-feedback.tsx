/**
 * A thumb on an assistant turn, and the sentence that explains the thumb.
 *
 * Replaces the notes it grew out of: a note was a free-text comment nobody
 * writes twice, a thumb is one click and gives the rating a number to aggregate
 * on. The sentence is optional and asked for after the fact, so the cheap
 * gesture is never blocked on the expensive one.
 *
 * Both events land on the conversation's trace — see `captureFeedback`. The
 * `$ai_trace_id` PostHog joins on is the *thread*, so `message_id` is what
 * narrows a rating to the turn it was given for.
 */

import type { ExpressionId } from "@repo/bloub";
import { useEffect, useRef, useState } from "react";
import { captureFeedback } from "../lib/analytics.tsx";
import { useChatSession } from "../lib/chat.tsx";

type Thumb = "up" | "down";

// PostHog's rating scale for a thumb survey: question 0, 1 up and 2 down.
const RESPONSE: Record<Thumb, number> = { up: 1, down: 2 };

/**
 * The face the vote puts on the agent — the engine's own two, at their catalogue
 * geometry, with nothing adjusted from here.
 *
 * `heureux` is the one expression whose ink is an arc rather than a filled
 * capsule, so it smiles by shape and needs no tilt to suggest it. That matters
 * because the tilt route is where the other happy faces live, and it is shared
 * with anger: `fier` at +18° and `hilare` at +20° are only 10° from `colere`'s
 * +30° over nearly identical eyes. `triste` is the far end of the same axis
 * instead — tops splayed at −28° over tall eyes — where nothing else sits, so it
 * is unambiguous.
 */
const FACE: Record<Thumb, ExpressionId> = { up: "heureux", down: "triste" };

export function MessageFeedback({
	messageId,
	index,
}: {
	messageId?: string;
	index: number;
}) {
	const { threadId, react } = useChatSession();
	const [thumb, setThumb] = useState<Thumb | null>(null);
	const submission = useRef<string | null>(null);
	const [asking, setAsking] = useState(false);
	const [draft, setDraft] = useState("");
	const [thanked, setThanked] = useState(false);
	const field = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (asking) field.current?.focus();
	}, [asking]);

	// The thumb is the answer. It is sent complete on the click rather than held
	// back for a sentence that may never be typed — a rating waiting on a
	// follow-up is a rating that gets lost when the tab closes.
	const rate = (value: Thumb) => {
		const id = crypto.randomUUID();
		submission.current = id;
		setThumb(value);
		setAsking(true);
		// The vote is aimed at the agent, so the agent answers it — see
		// `AgentAvatar`. A verdict that lands in a dashboard and nowhere else is a
		// verdict nobody feels they gave.
		react(FACE[value]);
		captureFeedback({
			$survey_response: RESPONSE[value],
			$ai_trace_id: threadId,
			$survey_submission_id: id,
			$survey_completed: true,
			...(messageId ? { message_id: messageId } : {}),
			message_index: index,
		});
	};

	// PostHog's rule for a second event under one submission id: it has to carry
	// every answer collected so far, so the thumb rides along with the sentence.
	const explain = () => {
		const text = draft.trim();
		if (!text || !thumb || !submission.current) return;
		captureFeedback({
			$survey_response: RESPONSE[thumb],
			$survey_response_1: text,
			$ai_trace_id: threadId,
			$survey_submission_id: submission.current,
			$survey_completed: true,
			...(messageId ? { message_id: messageId } : {}),
			message_index: index,
		});
		setDraft("");
		setAsking(false);
		setThanked(true);
	};

	return (
		<>
			{/*
			 * Out of flow, in the gutter beside the text column: an affordance on
			 * every assistant turn must cost no vertical space, or the turns it hangs
			 * off end up further apart than the conversation they make up.
			 */}
			<div className="absolute top-0 left-full ml-3 flex select-none gap-1.5 text-[11px] leading-[1.7]">
				<button
					type="button"
					onClick={() => rate("up")}
					title="helpful"
					className={`transition-opacity hover:text-fg ${
						thumb === "up"
							? "text-yellow opacity-100"
							: "text-dim opacity-0 group-hover:opacity-100 focus:opacity-100"
					}`}
				>
					▲
				</button>
				<button
					type="button"
					onClick={() => rate("down")}
					title="not helpful"
					className={`transition-opacity hover:text-fg ${
						thumb === "down"
							? "text-yellow opacity-100"
							: "text-dim opacity-0 group-hover:opacity-100 focus:opacity-100"
					}`}
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
						ref={field}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								explain();
							}
							if (e.key === "Escape") setAsking(false);
						}}
						placeholder="optional — ⏎ to send, esc to skip"
						className="min-w-0 flex-1 bg-transparent text-[12px] text-yellow caret-yellow outline-none placeholder:text-dim"
					/>
				</div>
			)}

			{thanked && (
				<div className="mt-1 select-none text-[11px] text-dim">thanks</div>
			)}
		</>
	);
}
