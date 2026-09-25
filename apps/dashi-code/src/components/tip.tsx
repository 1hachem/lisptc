"use client";

import { type ReactNode, useCallback, useState } from "react";

interface Held {
	x: number;
	y: number;
	body: ReactNode;
}

export function useTip() {
	const [held, setHeld] = useState<Held | null>(null);

	const bind = useCallback(
		(body: ReactNode) => ({
			onPointerEnter: (event: { clientX: number; clientY: number }) =>
				setHeld({ x: event.clientX, y: event.clientY, body }),
			onPointerMove: (event: { clientX: number; clientY: number }) =>
				setHeld((open) =>
					open === null
						? open
						: { ...open, x: event.clientX, y: event.clientY },
				),
			onPointerLeave: () => setHeld(null),
		}),
		[],
	);

	const layer =
		held === null ? null : (
			<div
				className="pointer-events-none fixed z-50 max-w-[280px] border border-bg2 bg-bg px-2.5 py-2 text-[11.5px] leading-relaxed shadow-lg"
				style={{ left: held.x + 14, top: held.y - 12 }}
			>
				{held.body}
			</div>
		);

	return { bind, layer };
}

export function TipLine({
	name,
	children,
}: {
	name: string;
	children?: ReactNode;
}) {
	return (
		<>
			<div className="text-fg">{name}</div>
			{children === undefined ? null : (
				<div className="text-dim tabular-nums">{children}</div>
			)}
		</>
	);
}
