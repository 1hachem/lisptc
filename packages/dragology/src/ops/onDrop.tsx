import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { Modifier, type OpResult } from "../op";

export function onDrop<T extends object>(
	this: DragSpec<T>,
	state: T | ((previewState: T) => T),
): DragSpec<T> {
	return operator(OnDropOp)(this, state);
}

class OnDropOp<T extends object> extends Modifier<T> {
	readonly name = "onDrop";

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly onDropState: T | ((previewState: T) => T),
	) {
		super(ctx, inner);
	}

	frame(frame: DragFrame): OpResult<T> {
		const result = this.inner.run(frame);
		return {
			...result,
			dropState:
				typeof this.onDropState === "function"
					? (this.onDropState as (s: T) => T)(result.dropState)
					: this.onDropState,
		};
	}
}
