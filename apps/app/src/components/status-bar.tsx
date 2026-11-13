import { SortableTree } from "@repo/components";
import {
	STATUS_BAR_SLOT_COUNT,
	type StatusBarItem,
} from "@repo/shared/status-bar";
import { type ReactNode, useEffect, useState } from "react";
import { useStatusBarOrder } from "../lib/status-bar.ts";
import { isGap, placeOf } from "../lib/status-bar-order.ts";
import { DesktopStatus } from "./desktop-status.tsx";
import { DesktopZoom } from "./desktop-zoom.tsx";

const TICK_MS = 15_000;

function placeClass(place: number): string {
	const middle = (STATUS_BAR_SLOT_COUNT + 1) / 2;
	if (place < middle) return "justify-start";
	if (place > middle) return "justify-end";
	return "justify-center";
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
	const { order, shown, reorder } = useStatusBarOrder();
	const drawn: Record<StatusBarItem, ReactNode> = {
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
				axis="horizontal"
				className="h-full"
				entryClassName={(item) =>
					`flex h-full w-full min-w-0 items-center overflow-hidden ${placeClass(placeOf(order, item))}`
				}
			>
				{(slot) => (isGap(slot) || !shown.includes(slot) ? null : drawn[slot])}
			</SortableTree>
		</footer>
	);
}
