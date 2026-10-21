import { type ReactNode, useEffect, useState } from "react";
import type { BarItem } from "../lib/status-bar-order.ts";

const TICK_MS = 15_000;

const LEFT = "col-start-1 justify-self-start";
const CENTRE = "col-start-2 justify-self-center";
const RIGHT = "col-start-3 justify-self-end";

const PLACES: Record<number, readonly string[]> = {
	1: [RIGHT],
	2: [LEFT, RIGHT],
	3: [LEFT, CENTRE, RIGHT],
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
}: {
	order: readonly BarItem[];
	items: Record<Exclude<BarItem, "clock">, ReactNode>;
}) {
	const drawn: Record<BarItem, ReactNode> = { ...items, clock: <Clock /> };
	return (
		<footer className="grid h-row flex-none grid-cols-[1fr_auto_1fr] items-center border-sidebar border-t bg-sidebar text-[11px] text-dim">
			{order.map((item, i) => (
				<div
					key={item}
					className={`row-start-1 flex h-full min-w-0 items-center ${PLACES[order.length]?.[i] ?? RIGHT}`}
				>
					{drawn[item]}
				</div>
			))}
		</footer>
	);
}
