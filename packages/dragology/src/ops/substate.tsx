import type { DragFrame, DragInitContext } from "../DragBehavior";
import {
	type DragSpec,
	DragSpecBuilder,
	type DragSpecData,
	operator,
} from "../DragSpec";
import { Box } from "../DragSpecTreeView";
import { type Draggable, makeDraggableProps } from "../draggable";
import { OverlayVis } from "../OverlayVis";
import {
	type Child,
	Operator,
	type OpOverlayVisProps,
	type OpResult,
	type OpTreeViewProps,
} from "../op";
import { getAtPath, type PathIn, setAtPath, type ValueAtPath } from "../paths";

export class SubstateMethod<T extends object> {
	substate<const P extends PathIn<T, any>>(
		state: T,
		path: P,
		fn: (d: DragSpecBuilder<ValueAtPath<T, P>>) => DragSpec<ValueAtPath<T, P>>,
	): DragSpec<T> {
		const subState = getAtPath(state, path as any) as ValueAtPath<T, P>;
		const innerSpec = fn(new DragSpecBuilder(subState));
		return operator(SubstateOp<T>)(
			state,
			path,
			innerSpec as unknown as DragSpecData<object>,
		);
	}
}

class SubstateOp<T extends object> extends Operator<T> {
	readonly name = "substate";
	readonly inner: Child<any>;

	constructor(
		ctx: DragInitContext<T>,
		readonly state: T,
		readonly path: (string | number)[],
		innerSpec: DragSpecData<object>,
	) {
		super(ctx);
		const lensedDraggable: Draggable<any> = (props) =>
			ctx.draggable(
				makeDraggableProps({
					state: setAtPath(state, path as any, props.state),
					draggedId: props.draggedId,
					setState: props.setState,
					isTracking: props.isTracking,
				}),
			);
		this.inner = this.child(
			null,
			innerSpec as any,
			{
				...ctx,
				draggable: lensedDraggable,
			} as any,
		);
	}

	frame(frame: DragFrame): OpResult<T> {
		const result = this.inner.run(frame);
		return {
			...result,
			dropState: setAtPath(this.state, this.path as any, result.dropState),
		};
	}

	treeView(props: OpTreeViewProps) {
		return (
			<Box label={`substate [${this.path.join(", ")}]`} path={props.path}>
				{this.inner.treeView(props)}
			</Box>
		);
	}

	overlayVis({ active }: OpOverlayVisProps) {
		return <OverlayVis op={this.inner.op} active={active} />;
	}
}
