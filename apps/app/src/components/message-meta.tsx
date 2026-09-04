/**
 * What a turn cost, under the turn.
 *
 * The agent answers by looping — model call, eval, model call — so "how long
 * did that take" has two honest answers: the one step in front of the reader,
 * and the whole question. Both are shown, in the same place: an intermediate
 * step reports itself, and the answer that ends the loop reports the turn (see
 * `meta.turn` in `@repo/ai`'s `stream.ts`, which is where these numbers come
 * from — the timings are the server's, not the browser's).
 *
 * A backend that reports no token usage simply leaves the counts out; the line
 * then carries the timing alone rather than a confident zero.
 */

import type { StepMeta } from "../lib/chat.tsx";

function formatDuration(ms: number): string {
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function formatTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function formatTime(at: string): string | null {
	const date = new Date(at);
	return Number.isNaN(date.getTime())
		? null
		: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MessageMeta({ meta }: { meta: StepMeta }) {
	// The answer's own generation is the cheap tail of a long turn, so once the
	// turn's totals are in they are the ones worth reading.
	const stats = meta.turn ?? meta;
	const parts: string[] = [];

	// Only the closing answer is a moment in the conversation worth dating; the
	// steps that led to it all happened at once, as far as a reader cares.
	if (meta.turn && meta.at) {
		const time = formatTime(meta.at);
		if (time) parts.push(time);
	}
	parts.push(`took ${formatDuration(stats.durationMs)}`);
	if (meta.turn)
		parts.push(`${meta.turn.steps} step${meta.turn.steps === 1 ? "" : "s"}`);
	if (stats.inputTokens !== undefined && stats.outputTokens !== undefined)
		parts.push(
			`${formatTokens(stats.inputTokens)} in`,
			`${formatTokens(stats.outputTokens)} out`,
		);

	return (
		<div className="mt-1 select-none text-[11px] text-dim leading-[1.7]">
			{parts.join(" · ")}
		</div>
	);
}
