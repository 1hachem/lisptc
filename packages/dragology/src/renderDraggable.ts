import { type Draggable, makeDraggableProps } from "./draggable";
import type { Svgx } from "./svgx";
import { type LayeredSvgx, layerSvg } from "./svgx/layers";
import { assignPaths } from "./svgx/path";
import { pipe } from "./utils/pipe";

export function renderDraggableInertUnlayered<T extends object>(
	draggable: Draggable<T>,
	state: T,
	draggedId: string | null,
	isTracking: boolean,
): Svgx {
	return pipe(
		draggable(
			makeDraggableProps({
				state,
				draggedId,
				setState: () => {
					throw new Error("This function should not have been called");
				},
				isTracking,
			}),
		),
		assignPaths,
	);
}

export function renderDraggableInert<T extends object>(
	draggable: Draggable<T>,
	state: T,
	draggedId: string | null,
	isTracking: boolean,
): LayeredSvgx {
	return layerSvg(
		renderDraggableInertUnlayered(draggable, state, draggedId, isTracking),
	);
}
