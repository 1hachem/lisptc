import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { Modifier, type OpResult } from "../op";
import { type Reader, readerToValue } from "../utils/flexible-types";

export function withInitContext<T extends object>(
	this: DragSpec<T>,
	f: Reader<Partial<DragInitContext<T>>, DragInitContext<T>>,
): DragSpec<T> {
	return operator(WithInitContextOp)(this, f);
}

class WithInitContextOp<T extends object> extends Modifier<T> {
	readonly name = "withInitContext";

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly f: Reader<Partial<DragInitContext<T>>, DragInitContext<T>>,
	) {
		super(ctx, inner, { ...ctx, ...readerToValue(f, ctx) });
	}

	frame(frame: DragFrame): OpResult<T> {
		return this.inner.run(frame);
	}
}
