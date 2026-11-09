import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { describeTransition } from "../DragSpecTreeView";
import { Modifier, type OpResult, type OpTreeViewProps } from "../op";
import {
	resolveTransitionLike,
	type Transition,
	type TransitionLike,
} from "../transition";

export function withDropTransition<T extends object>(
	this: DragSpec<T>,
	transition: TransitionLike,
): DragSpec<T> {
	return operator(WithDropTransitionOp)(
		this,
		resolveTransitionLike(transition),
	);
}

class WithDropTransitionOp<T extends object> extends Modifier<T> {
	readonly name = "withDropTransition";

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly transition: Transition | false,
	) {
		super(ctx, inner);
	}

	frame(frame: DragFrame): OpResult<T> {
		return { ...this.inner.run(frame), dropTransition: this.transition };
	}

	treeView(props: OpTreeViewProps) {
		return this.wrapperView(props, describeTransition(this.transition));
	}
}
