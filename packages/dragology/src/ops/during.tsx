import {
	type DragFrame,
	type DragInitContext,
	getElementPosition,
	renderStateReadOnly,
} from "../DragBehavior";
import { type DragSpec, type DragSpecData, operator } from "../DragSpec";
import { Box, OutputThumbnail } from "../DragSpecTreeView";
import { Modifier, type OpResult, type OpTreeViewProps } from "../op";
import type { LayeredSvgx } from "../svgx/layers";

export function during<T extends object>(
	this: DragSpec<T>,
	fn: (state: T) => T,
): DragSpec<T> {
	return operator(DuringOp)(this, fn);
}

class DuringOp<T extends object> extends Modifier<T> {
	readonly name = "during";
	outputPreview: LayeredSvgx | undefined;

	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		readonly duringFn: (state: T) => T,
	) {
		super(ctx, inner);
	}

	frame(frame: DragFrame): OpResult<T> {
		const result = this.inner.run(frame);
		const transformedState = this.duringFn(result.dropState);
		const preview = renderStateReadOnly(this.ctx, transformedState);
		const elementPos = getElementPosition(this.ctx, preview);
		this.outputPreview = preview;
		return {
			...result,
			preview: () => preview,
			dropState: transformedState,
			gap: elementPos ? frame.pointer.dist(elementPos) : Infinity,
			grabPos: elementPos ?? undefined,
		};
	}

	treeView(props: OpTreeViewProps) {
		return (
			<Box label="during" path={props.path}>
				{this.outputPreview && (
					<OutputThumbnail outputPreview={this.outputPreview} />
				)}
				{this.inner.treeView(props)}
			</Box>
		);
	}
}
