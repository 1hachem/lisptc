import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { Modifier, type OpResult } from "../op";

export function changeGap<T extends object>(
	this: DragSpec<T>,
	f: (gap: number) => number,
): DragSpec<T> {
	return operator(ChangeGapOp)(this, f);
}

class ChangeGapOp<T extends object> extends Modifier<T> {
	readonly name = "changeGap";

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly f: (gap: number) => number,
	) {
		super(ctx, inner);
	}

	frame(frame: DragFrame): OpResult<T> {
		const result = this.inner.run(frame);
		return { ...result, gap: this.f(result.gap) };
	}
}
