import { type ReactNode, useEffect, useState } from "react";

const TICK_MS = 15_000;

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

export function StatusBar({ children }: { children?: ReactNode }) {
	return (
		<footer className="flex h-row flex-none items-center justify-end border-sidebar border-t bg-sidebar text-[11px] text-dim">
			{children}
			<Clock />
		</footer>
	);
}
