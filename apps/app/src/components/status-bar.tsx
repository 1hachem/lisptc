import { SortableTree } from "@repo/components";
import { type ReactNode, useEffect, useState } from "react";
import { useSidebarMotion } from "../lib/sidebar.ts";
import {
	type BarItem,
	type BarPlace,
	placeOf,
} from "../lib/status-bar-order.ts";

const TICK_MS = 15_000;

const PLACE_CLASS: Record<BarPlace, string> = {
	left: "col-start-1 justify-self-start",
	centre: "col-start-2 justify-self-center",
	right: "col-start-3 justify-self-end",
};

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

export function StatusBar({
	order,
	items,
	onReorder,
}: {
	order: readonly BarItem[];
	items: Record<Exclude<BarItem, "clock">, ReactNode>;
	onReorder: (next: BarItem[]) => void;
}) {
	const { motion } = useSidebarMotion();
	const drawn: Record<BarItem, ReactNode> = { ...items, clock: <Clock /> };
	return (
		<footer className="h-row flex-none border-sidebar border-t bg-sidebar text-[11px] text-dim">
			<SortableTree
				order={order}
				onReorder={onReorder}
				motion={motion}
				axis="horizontal"
				className="grid h-full grid-cols-[1fr_auto_1fr] items-center"
				entryClassName={(item) =>
					`row-start-1 flex h-full min-w-0 items-center ${PLACE_CLASS[placeOf(order, item)]}`
				}
			>
				{(item) => drawn[item]}
			</SortableTree>
		</footer>
	);
}
