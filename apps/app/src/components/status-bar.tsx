import { SortableTree } from "@repo/components";
import { type ReactNode, useEffect, useState } from "react";
import { useSidebarMotion } from "../lib/sidebar.ts";
import { useStatusBarOrder } from "../lib/status-bar.ts";
import {
	type BarItem,
	isGap,
	placeOf,
	SLOT_COUNT,
} from "../lib/status-bar-order.ts";
import { DesktopStatus } from "./desktop-status.tsx";
import { DesktopZoom } from "./desktop-zoom.tsx";

const TICK_MS = 15_000;

const COLUMN_CLASS: readonly string[] = [
	"col-start-1",
	"col-start-2",
	"col-start-3",
	"col-start-4",
	"col-start-5",
	"col-start-6",
	"col-start-7",
];

function placeClass(place: number): string {
	const column = COLUMN_CLASS[place - 1] ?? "col-start-7";
	if (place === 1) return `${column} justify-self-start`;
	if (place === SLOT_COUNT) return `${column} justify-self-end`;
	return `${column} justify-self-center`;
}

function clockTime(at: Date): string {
	return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Clock() {
	const [now, setNow] = useState<Date | null>(null);
	useEffect(() => {
		setNow(new Date());
		const timer = setInterval(() => setNow(new Date()), TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return (
		<time
			dateTime={now?.toISOString()}
			className="flex h-full flex-none items-center px-2.5 tabular-nums"
		>
			{now ? clockTime(now) : ""}
		</time>
	);
}

export function StatusBar({ indicator }: { indicator: ReactNode }) {
	const { motion } = useSidebarMotion();
	const { order, shown, reorder } = useStatusBarOrder();
	const drawn: Record<BarItem, ReactNode> = {
		panes: indicator,
		desktop: (
			<>
				<DesktopZoom />
				<DesktopStatus />
			</>
		),
		clock: <Clock />,
	};
	return (
		<footer className="h-row flex-none border-sidebar border-t bg-sidebar text-[11px] text-dim">
			<SortableTree
				order={order}
				onReorder={reorder}
				motion={motion}
				axis="horizontal"
				className="grid h-full grid-cols-[minmax(0,auto)_repeat(5,minmax(0,1fr))_minmax(0,auto)] items-center"
				entryClassName={(item) =>
					`row-start-1 flex h-full min-w-0 items-center overflow-hidden ${placeClass(placeOf(order, item))}`
				}
			>
				{(slot) => (isGap(slot) || !shown.includes(slot) ? null : drawn[slot])}
			</SortableTree>
		</footer>
	);
}
