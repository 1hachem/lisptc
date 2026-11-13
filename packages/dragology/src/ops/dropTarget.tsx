import {
	type DragFrame,
	type DragInitContext,
	renderStateReadOnly,
} from "../DragBehavior";
import { type DragSpec, operator } from "../DragSpec";
import { Box, StateThumbnails } from "../DragSpecTreeView";
import { Vec2 } from "../math/vec2";
import { DistanceLine } from "../OverlayVis";
import {
	Operator,
	type OpOverlayVisProps,
	type OpResult,
	type OpTreeViewProps,
} from "../op";
import {
	type Bounds,
	boundsCenter,
	getGlobalBounds,
	pointInBounds,
} from "../svgx/bounds";
import type { LayeredSvgx } from "../svgx/layers";
import { assert } from "../utils/assert";

export function dropTarget<T extends object>(
	targetId: string,
	state: T,
	options?: { boundsState?: T },
): DragSpec<T> {
	return operator(DropTargetOp)(targetId, state, options?.boundsState);
}

class DropTargetOp<T extends object> extends Operator<T> {
	readonly name = "dropTarget";
	readonly preview: LayeredSvgx;
	readonly globalBounds: Bounds;
	inside = false;

	constructor(
		ctx: DragInitContext<T>,
		readonly targetId: string,
		readonly state: T,
		readonly boundsState: T | undefined,
	) {
		super(ctx);
		this.preview = renderStateReadOnly(ctx, state);
		const boundsLayered =
			boundsState === undefined
				? this.preview
				: renderStateReadOnly(ctx, boundsState);
		const targetLayer = boundsLayered.byId.get(targetId);
		assert(
			targetLayer !== undefined,
			`dropTarget: element with id "${targetId}" not found in rendered state`,
		);
		this.globalBounds = getGlobalBounds(
			targetLayer.element,
			targetLayer.element.props.transform ?? "",
		);
		assert(
			!this.globalBounds.empty,
			`dropTarget: could not compute bounds for element "${targetId}"`,
		);
	}

	frame(frame: DragFrame): OpResult<T> {
		this.inside = pointInBounds(frame.pointer, this.globalBounds);
		return {
			preview: () => this.preview,
			dropState: this.state,
			gap: this.inside ? 0 : Infinity,
		};
	}

	fuzzDropPositions() {
		return this.globalBounds.empty ? [] : [boundsCenter(this.globalBounds)];
	}

	treeView({ path, active, color }: OpTreeViewProps) {
		return (
			<Box
				label={`dropTarget → ${this.targetId}`}
				active={active}
				color={color}
				path={path}
			>
				{this.frames > 0 && (
					<StateThumbnails
						renderedStates={[{ layered: this.preview, position: Vec2(0) }]}
					/>
				)}
			</Box>
		);
	}

	overlayVis({ opacity }: OpOverlayVisProps) {
		const bounds = this.globalBounds;
		if (!this.lastFrame || bounds.empty) return null;
		const { pointer } = this.lastFrame;
		return (
			<g opacity={opacity}>
				<rect
					x={bounds.minX}
					y={bounds.minY}
					width={bounds.maxX - bounds.minX}
					height={bounds.maxY - bounds.minY}
					fill="magenta"
					fillOpacity={0.15}
					stroke="magenta"
					strokeWidth={1.5}
				/>
				<DistanceLine
					from={boundsCenter(bounds)}
					to={pointer}
					distance={this.inside ? 0 : Infinity}
				/>
			</g>
		);
	}
}
