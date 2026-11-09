import type { Chaining, DragSpecData } from "./DragSpec";
import { type Draggable, makeDraggableProps } from "./draggable";
import type { Vec2 } from "./math/vec2";
import { type Operator, opBehavior } from "./op";
import {
	renderDraggableInert,
	renderDraggableInertUnlayered,
} from "./renderDraggable";
import { findElement } from "./svgx";
import { findByPathInLayered, type LayeredSvgx } from "./svgx/layers";
import { findByPath } from "./svgx/path";
import { localToGlobal } from "./svgx/transform";
import type { Transition } from "./transition";
import { assertDefined } from "./utils/assert";

export type DragBehavior<T extends object> = (
	frame: DragFrame,
) => DragResult<T>;

export type DragFrame = {
	pointer: Vec2;
};

export type DragResult<T extends object> = {
	preview: () => LayeredSvgx;
	dropState: T;
	dropTransition?: Transition | false;
	activePathTransition?: Transition | false;
	gap: number;
	grabPos?: Vec2;
	activePath: string;
	chainNow?: Chaining<T>;
	op: Operator<T>;
};

export type DragInitContext<T extends object> = {
	draggable: Draggable<T>;
	draggedPath: string;
	draggedId: string | null;
	anchorPos: Vec2;
	startState: T;
	debug: {
		varyVisualizer: boolean;
	};
};

export function dragSpecToBehavior<T extends object>(
	spec: DragSpecData<T>,
	ctx: DragInitContext<T>,
): DragBehavior<T> {
	return opBehavior(new spec.opClass(ctx, ...spec.args));
}

export function renderStateReadOnly<T extends object>(
	ctx: DragInitContext<T>,
	state: T,
): LayeredSvgx {
	return renderDraggableInert(ctx.draggable, state, ctx.draggedId, false);
}

export function getElementPositionCheap<T extends object>(
	ctx: DragInitContext<T>,
	state: T,
): Vec2 | null {
	if (ctx.draggedId) {
		const raw = ctx.draggable(
			makeDraggableProps({
				state,
				draggedId: ctx.draggedId,
				setState: () => {
					throw new Error("This function should not have been called");
				},
				isTracking: true,
			}),
		);
		const found = findElement(raw, (el) => el.props.id === ctx.draggedId);
		if (!found) return null;
		return localToGlobal(found.accumulatedTransform, ctx.anchorPos);
	}
	const content = renderDraggableInertUnlayered(
		ctx.draggable,
		state,
		ctx.draggedId,
		true,
	);
	const found = findByPath(ctx.draggedPath, content);
	if (!found) return null;
	return localToGlobal(found.accumulatedTransform, ctx.anchorPos);
}

export function getElementPosition<T extends object>(
	ctx: DragInitContext<T>,
	layered: LayeredSvgx,
): Vec2 | null {
	const found = findByPathInLayered(ctx.draggedPath, layered);
	if (!found) return null;
	return localToGlobal(found.accumulatedTransform, ctx.anchorPos);
}

export function getElementPositionOrThrow<T extends object>(
	ctx: DragInitContext<T>,
	layered: LayeredSvgx,
): Vec2 {
	return assertDefined(getElementPosition(ctx, layered));
}
