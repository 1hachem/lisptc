import { count } from "@/lib/format.ts";
import type { Tone } from "./ui.tsx";

const fill: Record<Tone, string> = {
	green: "bg-green",
	yellow: "bg-yellow",
	red: "bg-red",
	blue: "bg-blue",
	neutral: "bg-dim",
};

export interface Slice {
	label: string;
	value: number;
	tone: Tone;
	opacity?: number;
}

export function PartToWhole({ slices }: { slices: Slice[] }) {
	const total = slices.reduce((sum, slice) => sum + slice.value, 0);
	if (total === 0) return <p className="m-0 text-dim">nothing observed</p>;

	return (
		<div className="grid gap-2">
			<div className="flex h-6 w-full gap-[2px] overflow-hidden">
				{slices
					.filter((slice) => slice.value > 0)
					.map((slice) => (
						<div
							className={fill[slice.tone]}
							key={slice.label}
							style={{
								width: `${(slice.value / total) * 100}%`,
								opacity: slice.opacity ?? 1,
							}}
						/>
					))}
			</div>
			<dl className="m-0 flex flex-wrap gap-x-5 gap-y-1">
				{slices.map((slice) => (
					<div className="flex items-baseline gap-1.5" key={slice.label}>
						<span
							className={`inline-block h-2 w-2 ${fill[slice.tone]}`}
							style={{ opacity: slice.opacity ?? 1 }}
						/>
						<dt className="m-0 text-[12px] text-dim">{slice.label}</dt>
						<dd className="m-0 text-[12px] text-fg tabular-nums">
							{count(slice.value)}
						</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

export interface Row {
	label: string;
	note?: string;
	value: number;
	tone: Tone;
}

export function Ranked({ rows }: { rows: Row[] }) {
	const top = rows.reduce((high, row) => Math.max(high, row.value), 0);
	if (rows.length === 0) return <p className="m-0 text-dim">nothing here</p>;

	return (
		<div className="grid gap-1.5">
			{rows.map((row) => (
				<div
					className="grid min-w-0 gap-1"
					key={`${row.label}-${row.note ?? ""}`}
				>
					<div className="flex min-w-0 items-baseline justify-between gap-3">
						<span className="min-w-0 truncate text-[12px] text-fg">
							{row.label}
						</span>
						<span className="shrink-0 text-[12px] text-dim tabular-nums">
							{row.note === undefined ? null : (
								<span className="mr-2">{row.note}</span>
							)}
							{count(row.value)}
						</span>
					</div>
					<div className="h-1.5 w-full bg-bg2">
						<div
							className={fill[row.tone]}
							style={{
								width: top === 0 ? "0%" : `${(row.value / top) * 100}%`,
								height: "100%",
							}}
						/>
					</div>
				</div>
			))}
		</div>
	);
}
