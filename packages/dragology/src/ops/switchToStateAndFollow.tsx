import type { DragFrame, DragInitContext } from "../DragBehavior";
import {
	type DragSpec,
	type DragSpecLike,
	operator,
	resolveDragSpecLike,
} from "../DragSpec";
import { Box } from "../DragSpecTreeView";
import { getOnDragCallbackOnElement } from "../draggable";
import { Modifier, type OpResult, type OpTreeViewProps } from "../op";
import { renderDraggableInertUnlayered } from "../renderDraggable";
import { findElement } from "../svgx";
import { assert } from "../utils/assert";

export function switchToStateAndFollow<T extends object>(
	state: T,
	draggedId: string,
	followSpec?: DragSpecLike<T>,
): DragSpec<T> {
	return operator(SwitchToStateAndFollowOp)(
		state,
		draggedId,
		followSpec && resolveDragSpecLike(followSpec),
	);
}

function findFollowSpec<T extends object>(
	ctx: DragInitContext<T>,
	state: T,
	draggedId: string,
	followSpec: DragSpec<T> | undefined,
): DragSpec<T> {
	if (!followSpec && draggedId) {
		const content = renderDraggableInertUnlayered(
			ctx.draggable,
			state,
			draggedId,
			true,
		);
		const found = findElement(content, (el) => el.props.id === draggedId);
		assert(!!found, `switchToStateAndFollow: element "${draggedId}" not found`);
		const callback = getOnDragCallbackOnElement<T>(found.element);
		assert(
			!!callback,
			`switchToStateAndFollow: no followSpec and no dragology on "${draggedId}"`,
		);
		followSpec = callback();
	}
	assert(!!followSpec, "switchToStateAndFollow: no followSpec");
	return followSpec;
}

class SwitchToStateAndFollowOp<T extends object> extends Modifier<T> {
	readonly name = "switchToStateAndFollow";

	constructor(
		ctx: DragInitContext<T>,
		readonly state: T,
		readonly draggedId: string,
		followSpec: DragSpec<T> | undefined,
	) {
		super(ctx, findFollowSpec(ctx, state, draggedId, followSpec), {
			...ctx,
			startState: state,
			draggedId,
			draggedPath: draggedId + "/",
		});
	}

	frame(frame: DragFrame): OpResult<T> {
		return this.inner.run(frame);
	}

	treeView(props: OpTreeViewProps) {
		return (
			<Box
				label={`switchToStateAndFollow → ${this.draggedId}`}
				color={props.color}
				path={props.path}
			>
				{this.inner.treeView(props)}
			</Box>
		);
	}
}
