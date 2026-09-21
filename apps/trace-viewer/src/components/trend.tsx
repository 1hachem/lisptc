"use client";

import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@repo/ui";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { day, moment } from "@/lib/format.ts";
import type { Trend } from "@/lib/trend.ts";

const STROKES = [
	"var(--blue)",
	"var(--orange)",
	"var(--aqua)",
	"var(--purple)",
	"var(--yellow)",
	"var(--green)",
	"var(--red)",
];

function strokeOf(index: number): string {
	return STROKES[index % STROKES.length] ?? "var(--fg)";
}

export function SuccessTrend({ trend }: { trend: Trend }) {
	const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

	const config = useMemo<ChartConfig>(
		() =>
			Object.fromEntries(
				trend.series.map((one, index) => [
					one.key,
					{ label: one.target, color: strokeOf(index) },
				]),
			),
		[trend.series],
	);

	if (trend.points.length === 0) return null;

	const shown = trend.series.filter((one) => !hidden.has(one.key));

	const toggle = (key: string) =>
		setHidden((was) => {
			const next = new Set(was);
			if (!next.delete(key)) next.add(key);
			return next;
		});

	return (
		<section className="border border-bg2 bg-bg1 px-4 pt-3.5 pb-2">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="text-[11px] text-dim uppercase tracking-[0.14em]">
					checks passed over time
				</span>
				<div className="flex flex-wrap gap-1.5">
					{trend.series.map((one, index) => {
						const on = !hidden.has(one.key);
						return (
							<button
								className={`flex items-center gap-1.5 border px-2 py-px text-[11.5px] transition-colors ${
									on
										? "border-dim/50 text-fg"
										: "border-bg2 text-dim hover:text-fg"
								}`}
								key={one.key}
								onClick={() => toggle(one.key)}
								type="button"
							>
								<span
									className="size-2 shrink-0"
									style={{
										backgroundColor: on ? strokeOf(index) : "var(--bg2)",
									}}
								/>
								{one.target}
							</button>
						);
					})}
				</div>
			</div>

			<ChartContainer className="aspect-auto h-[220px] w-full" config={config}>
				<LineChart
					data={trend.points}
					margin={{ top: 20, right: 12, bottom: 0, left: 0 }}
				>
					<CartesianGrid stroke="var(--bg2)" vertical={false} />
					<XAxis
						axisLine={false}
						dataKey="at"
						domain={["dataMin", "dataMax"]}
						scale="time"
						tickFormatter={day}
						tickLine={false}
						tickMargin={8}
						type="number"
					/>
					<YAxis
						axisLine={false}
						domain={[0, 100]}
						interval={0}
						tickFormatter={(value: number) => `${value}%`}
						tickLine={false}
						tickMargin={8}
						ticks={[0, 25, 50, 75, 100]}
						width={56}
					/>
					<ChartTooltip
						content={
							<ChartTooltipContent
								formatter={(value, name) => (
									<>
										<span
											className="size-2.5 shrink-0"
											style={{ backgroundColor: `var(--color-${name})` }}
										/>
										<span className="flex flex-1 justify-between gap-4 leading-none">
											<span className="text-dim">
												{config[String(name)]?.label}
											</span>
											<span className="font-mono text-fg tabular-nums">
												{value}%
											</span>
										</span>
									</>
								)}
								labelFormatter={(_label, payload) =>
									moment(Number(payload?.[0]?.payload?.at))
								}
							/>
						}
					/>
					{shown.map((one) => (
						<Line
							activeDot={{ r: 4 }}
							connectNulls
							dataKey={one.key}
							dot={{ r: 2.5, strokeWidth: 0, fill: `var(--color-${one.key})` }}
							isAnimationActive={false}
							key={one.key}
							stroke={`var(--color-${one.key})`}
							strokeWidth={1.5}
							type="linear"
						/>
					))}
				</LineChart>
			</ChartContainer>
		</section>
	);
}
