"use client";

import { type ChartConfig, ChartContainer } from "@repo/ui";
import {
	CartesianGrid,
	Scatter,
	ScatterChart,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { basename } from "@/lib/format.ts";
import type { ComplexityFinding } from "@/lib/report.ts";

const config = {
	crap: { label: "CRAP", color: "var(--color-blue)" },
} satisfies ChartConfig;

interface Point {
	name: string;
	path: string;
	line: number;
	cyclomatic: number;
	crap: number;
}

function Detail({
	active,
	payload,
}: {
	active?: boolean;
	payload?: unknown[];
}) {
	if (active !== true || payload === undefined || payload.length === 0)
		return null;
	const point = (payload[0] as { payload: Point }).payload;
	return (
		<div className="border border-bg2 bg-bg px-2.5 py-2 text-[11.5px]">
			<div className="text-fg">{point.name}</div>
			<div className="text-dim">
				{basename(point.path)}:{point.line}
			</div>
			<div className="mt-1 text-dim tabular-nums">
				cyclomatic {point.cyclomatic} · crap {point.crap.toFixed(1)}
			</div>
		</div>
	);
}

export function ComplexityScatter({
	findings,
}: {
	findings: ComplexityFinding[];
}) {
	const points: Point[] = findings
		.filter(
			(finding) =>
				finding.cyclomatic !== null &&
				finding.cyclomatic !== undefined &&
				finding.crap !== null &&
				finding.crap !== undefined,
		)
		.map((finding) => ({
			name: finding.name,
			path: finding.path,
			line: finding.line,
			cyclomatic: finding.cyclomatic as number,
			crap: finding.crap as number,
		}));

	if (points.length === 0)
		return (
			<p className="m-0 text-dim">no complexity findings in this report</p>
		);

	return (
		<ChartContainer className="h-[280px] w-full" config={config}>
			<ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 8 }}>
				<CartesianGrid stroke="var(--color-bg2)" strokeDasharray="2 4" />
				<XAxis
					axisLine={false}
					dataKey="cyclomatic"
					fontSize={11}
					label={{
						value: "cyclomatic",
						position: "insideBottom",
						offset: -14,
						fill: "var(--color-dim)",
						fontSize: 11,
					}}
					stroke="var(--color-dim)"
					tickLine={false}
					type="number"
				/>
				<YAxis
					axisLine={false}
					dataKey="crap"
					fontSize={11}
					stroke="var(--color-dim)"
					tickLine={false}
					type="number"
					width={44}
				/>
				<Tooltip content={<Detail />} cursor={false} />
				<Scatter
					data={points}
					fill="var(--color-crap)"
					fillOpacity={0.75}
					stroke="var(--color-bg)"
					strokeWidth={2}
				/>
			</ScatterChart>
		</ChartContainer>
	);
}
