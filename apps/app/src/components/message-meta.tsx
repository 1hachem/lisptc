/**
 * What a model call cost, under the message it produced.
 *
 * Strictly per-call, never added up across the loop: the agent answers by
 * looping — model call, eval, model call — and every call is handed the whole
 * conversation so far, so each step's input already contains the ones before
 * it. Adding them would charge the same prompt several times over. The step
 * count is the one exception: it belongs to the turn, so it rides on the answer
 * that ends the loop and nowhere else.
 *
 * The numbers come from `meta` in `@repo/ai`'s `stream.ts`, so the timings are
 * the server's, not the browser's. A backend that reports no token usage simply
 * leaves the counts out; the line then carries the timing alone rather than a
 * confident zero.
 *
 * What the line shows is `META_FIELDS` — one flag per field, edit it to change
 * the line everywhere. `<MessageMeta show={…}>` overrides it for one message,
 * which is also where a runtime toggle would feed in.
 */

import type { StepMeta } from "../lib/chat.tsx";

/**
 * A field of the line. `cached` is the odd one out: it is a slice of the input
 * rather than a figure of its own, so it renders inside the `input` field and
 * its flag only says whether that parenthetical appears.
 */
export type MetaField =
	| "time"
	| "duration"
	| "steps"
	| "input"
	| "cached"
	| "output";

/** Which fields the line carries. Flip one to hide it everywhere. */
export const META_FIELDS: Record<MetaField, boolean> = {
	time: true,
	duration: true,
	steps: true,
	input: true,
	cached: true,
	output: true,
};

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

/**
 * The line, in reading order. A field returning `null` had nothing to report —
 * the server left it out — and drops out the same way a hidden one does.
 */
const SEGMENTS: {
	field: MetaField;
	render: (meta: StepMeta, show: Record<MetaField, boolean>) => string | null;
}[] = [
	{ field: "time", render: (m) => (m.at ? formatTime(m.at) : null) },
	{ field: "duration", render: (m) => `took ${formatDuration(m.durationMs)}` },
	{
		field: "steps",
		render: (m) =>
			m.steps === undefined
				? null
				: `${m.steps} step${m.steps === 1 ? "" : "s"}`,
	},
	{
		field: "input",
		render: (m, show) => {
			if (m.inputTokens === undefined) return null;
			const cached = show.cached ? m.cachedInputTokens : undefined;
			const total = formatTokens(m.inputTokens);
			return cached
				? `${total} in (${formatTokens(cached)} cached)`
				: `${total} in`;
		},
	},
	{
		field: "output",
		render: (m) =>
			m.outputTokens === undefined
				? null
				: `${formatTokens(m.outputTokens)} out`,
	},
];

export function MessageMeta({
	meta,
	show,
}: {
	meta: StepMeta;
	show?: Partial<Record<MetaField, boolean>>;
}) {
	const fields = show ? { ...META_FIELDS, ...show } : META_FIELDS;
	const parts = SEGMENTS.filter((s) => fields[s.field])
		.map((s) => s.render(meta, fields))
		.filter((part): part is string => part !== null);

	if (parts.length === 0) return null;

	return (
		<div className="mt-1 select-none text-[11px] text-dim leading-[1.7]">
			{parts.join(" · ")}
		</div>
	);
}
