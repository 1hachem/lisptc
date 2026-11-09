import type { DragFrame, DragInitContext } from "../DragBehavior";
import { type DragSpec, operator } from "../DragSpec";
import { Box } from "../DragSpecTreeView";
import { Operator, type OpResult, type OpTreeViewProps } from "../op";

export function custom<T extends object>(
	fn: (ctx: DragInitContext<T>) => (frame: DragFrame) => OpResult<T>,
): DragSpec<T> {
	return operator(CustomOp)(fn);
}

class CustomOp<T extends object> extends Operator<T> {
	readonly name = "custom";
	readonly behavior: (frame: DragFrame) => OpResult<T>;

	constructor(
		ctx: DragInitContext<T>,
		readonly fn: (ctx: DragInitContext<T>) => (frame: DragFrame) => OpResult<T>,
	) {
		super(ctx);
		this.behavior = fn(ctx);
	}

	frame(frame: DragFrame): OpResult<T> {
		return this.behavior(frame);
	}

	treeView({ path }: OpTreeViewProps) {
		return (
			<Box label="custom" path={path}>
				not supported yet
			</Box>
		);
	}

	overlayVis() {
		return null;
	}
}
