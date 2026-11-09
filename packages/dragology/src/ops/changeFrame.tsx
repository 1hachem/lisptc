import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { Modifier, type OpResult } from "../op";
import { type Reader, readerToValue } from "../utils/flexible-types";

export function changeFrame<T extends object>(
	this: DragSpec<T>,
	f: Reader<Partial<DragFrame>, DragFrame>,
): DragSpec<T> {
	return operator(ChangeFrameOp)(this, f);
}

class ChangeFrameOp<T extends object> extends Modifier<T> {
	readonly name = "changeFrame";

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly f: Reader<Partial<DragFrame>, DragFrame>,
	) {
		super(ctx, inner);
	}

	frame(frame: DragFrame): OpResult<T> {
		return this.inner.run({ ...frame, ...readerToValue(this.f, frame) });
	}
}
