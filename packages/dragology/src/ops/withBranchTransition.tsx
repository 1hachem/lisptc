import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { describeTransition } from "../DragSpecTreeView";
import { Modifier, type OpResult, type OpTreeViewProps } from "../op";
import {
	resolveTransitionLike,
	type Transition,
	type TransitionLike,
} from "../transition";

export function withBranchTransition<T extends object>(
	this: DragSpec<T>,
	transition: TransitionLike,
): DragSpec<T> {
	return operator(WithBranchTransitionOp)(
		this,
		resolveTransitionLike(transition),
	);
}

class WithBranchTransitionOp<T extends object> extends Modifier<T> {
	readonly name = "withBranchTransition";

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly transition: Transition | false,
	) {
		super(ctx, inner);
	}

	frame(frame: DragFrame): OpResult<T> {
		return {
			...this.inner.run(frame),
			activePathTransition: this.transition,
		};
	}

	treeView(props: OpTreeViewProps) {
		return this.wrapperView(props, describeTransition(this.transition));
	}
}
