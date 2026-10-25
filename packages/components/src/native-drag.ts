import { type DragEvent as ReactDragEvent, useEffect, useState } from "react";

export function useNativeDropTarget(
	type: string | undefined,
	onDrop: (data: DataTransfer) => void,
) {
	const [over, setOver] = useState(false);
	const carries = (event: ReactDragEvent) =>
		type !== undefined && event.dataTransfer.types.includes(type);
	return {
		over,
		handlers: {
			onDragOver: (event: ReactDragEvent) => {
				if (!carries(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
				setOver(true);
			},
			onDragLeave: (event: ReactDragEvent) => {
				if (event.currentTarget.contains(event.relatedTarget as Node | null))
					return;
				setOver(false);
			},
			onDrop: (event: ReactDragEvent) => {
				setOver(false);
				if (!carries(event)) return;
				event.preventDefault();
				onDrop(event.dataTransfer);
			},
		},
	};
}

export function useNativeDrag(type: string | undefined): boolean {
	const [active, setActive] = useState(false);
	useEffect(() => {
		if (type === undefined) return;
		let depth = 0;
		const carries = (event: DragEvent) =>
			event.dataTransfer?.types.includes(type) ?? false;
		const enter = (event: DragEvent) => {
			if (!carries(event)) return;
			depth += 1;
			setActive(true);
		};
		const leave = (event: DragEvent) => {
			if (!carries(event)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) setActive(false);
		};
		const end = () => {
			depth = 0;
			setActive(false);
		};
		window.addEventListener("dragenter", enter);
		window.addEventListener("dragleave", leave);
		window.addEventListener("drop", end);
		window.addEventListener("dragend", end);
		return () => {
			window.removeEventListener("dragenter", enter);
			window.removeEventListener("dragleave", leave);
			window.removeEventListener("drop", end);
			window.removeEventListener("dragend", end);
		};
	}, [type]);
	return active;
}
