import {
	type DragFrame,
	type DragInitContext,
	getElementPosition,
	getElementPositionCheap,
	renderStateReadOnly,
} from "../DragBehavior";
import {
	type DragSpec,
	type DragSpecData,
	type DragSpecLike,
	operator,
	resolveDragSpecLike,
} from "../DragSpec";
import { Box } from "../DragSpecTreeView";
import type { Vec2 } from "../math/vec2";
import { OverlayVis } from "../OverlayVis";
import {
	type Child,
	Operator,
	type OpOverlayVisProps,
	type OpResult,
	type OpTreeViewProps,
} from "../op";
import { assert } from "../utils/assert";
import { minBy, range } from "../utils/collections";
import { type Many, manyToArray } from "../utils/flexible-types";

export function closest<T extends object>(
	specs: Many<DragSpecLike<T>>,
	options?: {
		stickiness?: number;
		lockPast?: number;
	},
): DragSpec<T> {
	return operator(ClosestOp)(
		manyToArray(specs).map(resolveDragSpecLike),
		options?.stickiness ?? 0,
		options?.lockPast,
	);
}

class ClosestOp<T extends object> extends Operator<T> {
	readonly name = "closest";
	readonly options: Child<T>[];
	lastBest: number | null = null;
	lockedIndex: number | null = null;
	ran: boolean[] = [];
	private readonly home: Vec2 | undefined;

	constructor(
		ctx: DragInitContext<T>,
		specs: DragSpecData<T>[],
		readonly stickiness: number,
		readonly lockPast: number | undefined,
	) {
		super(ctx);
		this.options = specs.map((s, i) => this.child(String(i), s));
		if (lockPast !== undefined) {
			const home = getElementPositionCheap(ctx, ctx.startState);
			assert(
				home !== null,
				"closest: dragged element not found in start state",
			);
			this.home = home;
		}
	}

	private isPastLock(result: OpResult<T>): boolean {
		if (this.home === undefined || this.lockPast === undefined) return false;
		const pos =
			result.grabPos ?? getElementPosition(this.ctx, result.preview());
		return pos === null || pos.dist(this.home) > this.lockPast;
	}

	frame(frame: DragFrame): OpResult<T> {
		if (this.options.length === 0) {
			return {
				preview: () => renderStateReadOnly(this.ctx, this.ctx.startState),
				dropState: this.ctx.startState,
				gap: Infinity,
				activePath: "none",
			};
		}
		const results: (OpResult<T> | undefined)[] = [];
		const resultAt = (i: number) => (results[i] ??= this.options[i].run(frame));

		if (
			this.lockedIndex !== null &&
			!this.isPastLock(resultAt(this.lockedIndex))
		) {
			this.lockedIndex = null;
		}
		let best = this.lockedIndex;
		if (best === null) {
			best = minBy(
				range(this.options.length),
				(i) => resultAt(i).gap - (i === this.lastBest ? this.stickiness : 0),
			)!;
			if (this.isPastLock(resultAt(best))) this.lockedIndex = best;
		}
		this.lastBest = best;
		this.ran = this.options.map((_o, i) => results[i] !== undefined);
		return resultAt(best);
	}

	treeView(props: OpTreeViewProps) {
		return (
			<Box label="closest" path={props.path}>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						gap: 4,
						flexWrap: "wrap",
					}}
				>
					{this.options.map((option, i) => (
						<div
							key={i}
							style={{ display: "flex", flexDirection: "column", gap: 1 }}
						>
							<div
								style={{
									fontSize: 9,
									color: "rgb(148, 163, 184)",
									paddingLeft: 2,
								}}
							>
								{i}
							</div>
							{option.treeView(props)}
						</div>
					))}
				</div>
			</Box>
		);
	}

	overlayVis({ active }: OpOverlayVisProps) {
		if (this.frames === 0) return null;
		return (
			<g>
				{this.options.map(
					(option, i) =>
						this.ran[i] && (
							<OverlayVis
								key={i}
								op={option.op}
								active={active && i === this.lastBest}
							/>
						),
				)}
			</g>
		);
	}
}
