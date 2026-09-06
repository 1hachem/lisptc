import type { StepMeta } from "../lib/chat.tsx";

export type MetaField =
	| "time"
	| "duration"
	| "steps"
	| "input"
	| "cached"
	| "output";

const META_FIELDS: Record<MetaField, boolean> = {
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
