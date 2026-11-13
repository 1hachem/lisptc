import type { DragFrame, DragInitContext } from "../DragBehavior";
import {
	type Chaining,
	type DragSpec,
	type DragSpecData,
	operator,
} from "../DragSpec";
import { Modifier, type OpResult } from "../op";
import { resolveTransitionLike, type TransitionLike } from "../transition";

export function withChaining<T extends object>(
	this: DragSpec<T>,
	{
		transition = true,
		...rest
	}: {
		draggedId?: string;
		followSpec?: DragSpec<T>;
		transition?: TransitionLike;
	} = {},
): DragSpec<T> {
	return operator(WithChainingOp)(this, {
		...rest,
		transition: resolveTransitionLike(transition),
	});
}

class WithChainingOp<T extends object> extends Modifier<T> {
	readonly name = "withChaining";

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly chaining: Chaining<T>,
	) {
		super(ctx, inner);
	}

	frame(frame: DragFrame): OpResult<T> {
		const result = this.inner.run(frame);
		return { ...result, chainNow: result.chainNow ?? this.chaining };
	}
}
