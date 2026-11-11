"use client";

import { DragOverlay, type DropAnimation } from "@dnd-kit/core";
import { type ReactNode, useState } from "react";

export function CursorDragOverlay({
	dropAnimation,
	children,
}: {
	dropAnimation?: DropAnimation | null;
	children: ReactNode;
}) {
	const [probe, setProbe] = useState<HTMLSpanElement | null>(null);
	const pageZoom = probe?.currentCSSZoom ?? 1;
	return (
		<>
			<span
				ref={setProbe}
				aria-hidden
				className="pointer-events-none absolute size-0"
			/>
			<div style={{ zoom: 1 / pageZoom }}>
				<DragOverlay dropAnimation={dropAnimation}>
					{children && <div style={{ zoom: pageZoom }}>{children}</div>}
				</DragOverlay>
			</div>
		</>
	);
}
