"use client";

import { TipLine, useTip } from "@/components/tip.tsx";
import { count } from "@/lib/format.ts";
import { quant, squarify } from "@/lib/plot.ts";
import type { FileRow } from "@/lib/snapshot.ts";

const W = 760;
const H = 430;

export function Treemap({ files }: { files: FileRow[] }) {
	const { bind, layer } = useTip();
	const sized = files.filter((file) => !file.isTest && (file.loc ?? 0) > 0);
	if (sized.length === 0) return <p className="m-0 text-dim">nothing sized</p>;

	const grouped = new Map<string, FileRow[]>();
	for (const file of sized) {
		const held = grouped.get(file.pkg);
		if (held === undefined) grouped.set(file.pkg, [file]);
		else held.push(file);
	}

	const outer = squarify(
		[...grouped].map(([pkg, rows]) => ({
			item: { pkg, rows },
			value: rows.reduce((sum, row) => sum + (row.loc ?? 0), 0),
		})),
		W,
		H,
	);
	const hottest = Math.max(...sized.map((file) => file.commits));

	return (
		<>
			<svg
				className="block h-auto w-full min-w-[520px]"
				viewBox={`0 0 ${W} ${H}`}
			>
				<title>lines of code by package, coloured by commits</title>
				{outer.map((group) => {
					const inner = squarify(
						group.item.rows.map((row) => ({ item: row, value: row.loc ?? 0 })),
						group.w,
						group.h,
					);
					return (
						<g key={group.item.pkg}>
							{inner.map((tile) => (
								<rect
									fill={quant(Math.sqrt(tile.item.commits / hottest))}
									height={Math.max(tile.h - 0.6, 0.4)}
									key={tile.item.path}
									stroke="var(--color-bg1)"
									strokeWidth={0.6}
									width={Math.max(tile.w - 0.6, 0.4)}
									x={group.x + tile.x}
									y={group.y + tile.y}
									{...bind(
										<TipLine name={tile.item.path}>
											{count(tile.item.loc ?? 0)} lines · {tile.item.commits}{" "}
											commits · {tile.item.trend}
										</TipLine>,
									)}
								/>
							))}
							<rect
								fill="none"
								height={group.h}
								stroke="var(--color-bg1)"
								strokeWidth={2.5}
								width={group.w}
								x={group.x}
								y={group.y}
							/>
							{group.w > 62 && group.h > 20 ? (
								<text
									fill="#fff"
									fontSize={10.5}
									fontWeight={600}
									paintOrder="stroke"
									stroke="rgba(0,0,0,.5)"
									strokeWidth={2.5}
									x={group.x + 5}
									y={group.y + 13}
								>
									{group.item.pkg.replace(/^packages\//, "")}
								</text>
							) : null}
						</g>
					);
				})}
			</svg>
			{layer}
		</>
	);
}
