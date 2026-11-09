import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { Modifier, type OpResult } from "../op";
import { type Reader, readerToValue } from "../utils/flexible-types";

export function changeResult<T extends object>(
	this: DragSpec<T>,
	f: Reader<Partial<OpResult<T>>, OpResult<T>>,
): DragSpec<T> {
	return operator(ChangeResultOp)(this, f);
}

class ChangeResultOp<T extends object> extends Modifier<T> {
	readonly name = "changeResult";

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly f: Reader<Partial<OpResult<T>>, OpResult<T>>,
	) {
		super(ctx, inner);
	}

	frame(frame: DragFrame): OpResult<T> {
		const result = this.inner.run(frame);
		const changed = readerToValue(this.f, result);
		const grabPos =
			"preview" in changed && !("grabPos" in changed)
				? undefined
				: result.grabPos;
		return { ...result, grabPos, ...changed };
	}
}
